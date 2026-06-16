# RepTree

RepTree is a small TypeScript library for replicated trees with properties.

Use it when your application state is naturally a tree and multiple peers may edit it: folders, documents with nested blocks, scene graphs, project structures, object graphs, or any UI model where nodes can move and carry properties.

RepTree is built on CRDTs, so peers can exchange operations in any order and converge on the same state without a central merge coordinator.

## Install

```bash
npm install reptree
```

## What RepTree Gives You

- Tree nodes that can be created, moved, deleted, and observed.
- JSON-serializable properties on every node.
- Last-writer-wins property conflict resolution.
- Move conflict resolution based on the move operation tree CRDT.
- Operation-based sync for persistence or peer replication.
- State vectors for efficient delta sync.
- Optional typed/reactive node bindings.

## Basic Usage

```ts
import { RepTree } from "reptree";

const tree = new RepTree("peer-a");
const root = tree.createRoot();
root.name = "Project";

const docs = root.newNamedChild("Docs", {
  type: "folder",
  icon: "folder",
});

const readme = docs.newNamedChild("README.md", {
  type: "file",
  size: 2048,
  tags: ["docs", "intro"],
});

const assets = root.newNamedChild("Assets", { type: "folder" });
readme.moveTo(assets);

console.log(readme.parent?.name); // "Assets"
console.log(readme.getProperty("size")); // 2048
```

## Sync

RepTree syncs by exchanging operations. Store operations, send them over the network, and merge operations received from other peers.

```ts
import { RepTree } from "reptree";

const alice = new RepTree("alice");
const aliceRoot = alice.createRoot();
aliceRoot.newNamedChild("Roadmap", { status: "draft" });

const bob = new RepTree("bob");
bob.merge(alice.getAllOps());

bob.root!.newNamedChild("Notes", { status: "open" });
alice.merge(bob.getAllOps());
```

For larger trees, use state vectors to send only operations the other peer is missing:

```ts
const aliceVectors = alice.getStateVectors();

if (aliceVectors) {
  const opsForAlice = bob.getMissingOps(aliceVectors);
  alice.merge(opsForAlice);
}
```

Property operations are compacted by `(nodeId, key)`: RepTree keeps the latest winning property operation for each property and uses the property state vector to describe that retained, sendable set. Move operations keep their history so the move CRDT can resolve structural conflicts.

## Typed Nodes

You can bind a node to a live typed object. Reads and writes go through RepTree.

```ts
type Task = {
  title: string;
  done: boolean;
};

const task = root.newNamedChild("Task").bind<Task>();
task.title = "Write README";
task.done = false;

task.$observe(() => {
  console.log(task.title, task.done);
});
```

Zod-style schemas are supported for runtime validation:

```ts
import { z } from "zod";

const TaskSchema = z.object({
  title: z.string(),
  done: z.boolean(),
});

const checkedTask = root.newNamedChild("Checked task").bind(TaskSchema);
checkedTask.title = "Publish package";
checkedTask.done = true;
```

## Operation Model

RepTree uses two conflict-free replicated data types:

- A move tree CRDT for the tree structure, based on Kleppmann's [move operation paper](https://martin.kleppmann.com/papers/move-op.pdf).
- A last-writer-wins (LWW) CRDT for node properties.

Both streams have independent counters and state vectors. This keeps property-heavy workloads compact while preserving the move history needed for deterministic tree convergence.

## Origin

RepTree was created for [Sila](https://github.com/silaorg/sila), an open-source alternative to ChatGPT.

## License

MIT
