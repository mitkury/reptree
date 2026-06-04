This is a context for AI editor/agent about the project. It's generated with a tool Airul (https://github.com/mitkury/airul) out of 5 sources. Edit .airul.json to change sources or enabled outputs. After any change to sources or .airul.json, run `airul gen` to regenerate the context.

# From README.md:

# RepTree - replicated trees with properties

A JavaScript tree data structure for storing and syncing app state. It can be used both to represent and persist the state in the frontend and backend.

RepTree uses [CRDTs](https://crdt.tech/) for seamless replication between users.

> RepTree was created for the [Sila](https://github.com/silaorg/sila) project, an open-source alternative to ChatGPT.

## What it solves

If you have a tree structure in your app where each node/node/leaf can be moved independently by multiple users, you need a solution that resolves conflicts when the same node is moved in different ways. Otherwise your tree can diverge or form loops. This includes folder structures (people creating and moving folders), 2D/3D scenes with objects being moved and parented, and Notion‑like documents where blocks with text and other properties are edited by users.

You probably also want properties on each node/node/leaf and to have them sync correctly between peers without conflicts. RepTree syncs properties too.

## Getting started

```bash
npm install reptree
```

### Example 1
```ts
import { RepTree } from "reptree";

// Create a tree with a root
const tree = new RepTree("company-org-1");
const company = tree.createRoot();

// Create a node (we call them nodes in RepTree) in the root of our new tree
const devs = company.newNamedChild("developers");
const qa = company.newNamedChild("qa");

// Create a node in another node
const alice = qa.newChild();

// Set properties (supports any JSON-serializable values)
alice.setProperty("name", "Alice");
alice.setProperty("age", 32);
alice.setProperty("meta", { department: "QA", skills: ["cypress", "playwright"], flags: { lead: false } });

// Move the node inside a different node
alice.moveTo(devs);

// Bind a node to a type to set its properties like regular fields
const bob = qa.newChild().bind<{ name: string; age: number }>();
bob.name = "Bob";
bob.age = 33;

// Use a Zod type for runtime type checks
import { z } from "zod";
const Person = z.object({ name: z.string(), age: z.number().int().min(0) });
const casey = devs.newNamedChild("Casey").bind(Person);
casey.name = "Casey";
casey.age = 34;
```

### Example 2

```typescript
import { RepTree } from "reptree";

// Create a new tree
const tree = new RepTree("peer1");
const root = tree.createRoot();
root.name = "Project";

// Create a folder structure with properties
const docsFolder = root.newNamedChild("Docs");
docsFolder.setProperties({
  type: "folder",
  icon: "folder-icon",
});

const imagesFolder = root.newNamedChild("Images");
imagesFolder.setProperties({
  type: "folder",
  icon: "image-icon",
});

// Add files to folders
const readmeFile = docsFolder.newNamedChild("README.md");
readmeFile.setProperties({
  type: "file",
  size: 2048,
  lastModified: "2023-10-15T14:22:10Z",
  s3Path: "s3://my-bucket/docs/README.md",
});

const logoFile = imagesFolder.newNamedChild("logo.png");
logoFile.setProperties({
  type: "file",
  size: 15360,
  meta: { dimensions: "512x512", format: "png" },
  s3Path: "s3://my-bucket/images/logo.png",
});

// Move a file to a different folder
logoFile.moveTo(docsFolder);

// Get children of a folder
const docsFolderContents = docsFolder.children;

// Syncing between trees
const otherTree = new RepTree("peer2");
const ops = tree.getAllOps();
otherTree.merge(ops);
```

## CRDTs

RepTree uses two conflict-free replicated data types (CRDTs):
- A move tree CRDT for the tree structure (https://martin.kleppmann.com/papers/move-op.pdf).
- A last-writer-wins (LWW) CRDT is for properties.

## License

MIT
---

# From docs/dev/rules-for-ai.md:

# Rules for AI

## TLDR Context
It's an NPM package at https://www.npmjs.com/package/reptree
If you're not sure about what is the feature name for a commit - look at the list of commits in the git history or ask the user.

## Test often
After a big change or before committing, do "npm test"

## Commit messages
Short and concise.
Add "<scope>: <description>" suffix.

Scopes:
feat(name-of-a-feature) - any dedicated feature
docs - anything related to .md docs in /docs directory
test - anything related to tests
bench - anything related to benchmarks

## Publishing
1. Commit changes with descriptive message
2. Run "npm version patch" (or minor/major) to bump version
3. Push the tag to trigger the release workflow:
   ```
   git push origin v[version]  # e.g., git push origin v0.4.5
   ```
4. Run "npm publish" to publish to npm
---

# From package.json:

{
  "name": "reptree",
  "version": "1.0.0",
  "description": "A tree data structure using CRDTs for seamless replication between peers",
  "main": "dist/index.cjs",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": [
    "dist",
    "README.md"
  ],
  "scripts": {
    "prepare": "npx airul gen",
    "prebuild": "rm -rf dist",
    "build": "tsup",
    "dev": "tsup --watch",
    "pretest": "npm run build",
    "test": "vitest",
    "prepublishOnly": "npm run build"
  },
  "keywords": [
    "crdt",
    "tree",
    "data-structure",
    "replication"
  ],
  "author": "Dmitry Kury (d@dkury.com)",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/mitkury/reptree.git"
  },
  "homepage": "https://github.com/mitkury/reptree#readme",
  "bugs": {
    "url": "https://github.com/mitkury/reptree/issues"
  },
  "devDependencies": {
    "airul": "^0.1.39",
    "ts-node": "^10.9.1",
    "tsup": "^8.0.1",
    "typescript": "^5.2.2",
    "vitest": "^1.0.0",
    "zod": "^4.0.0"
  },
  "dependencies": {}
}
---

# From docs/vector-states.md:

# Range-Based State Vectors in RepTree

## Overview

RepTree uses range-based state vectors to track which operations are available for synchronization across peers. This approach allows for compact representation of operation history and optimized synchronization by identifying only the missing operations that need to be transferred.

## Implementation

### State Vector Structure

RepTree keeps separate state vectors for move operations and property operations:

```typescript
type StateVectors = {
  move: Record<string, number[][]>;
  prop: Record<string, number[][]>;
};

// Example:
// {
//   move: { "peer1": [[1, 5], [8, 10]], "peer2": [[1, 7]] },
//   prop: { "peer1": [[1, 12]], "peer2": [[1, 4]] }
// }
```

Each range `[start, end]` represents a continuous sequence of operations with counters from `start` to `end` (inclusive) that have been applied from that peer.

Move and property operations use independent counters, so the same peer/counter pair can exist in both streams. Operation IDs are unique within a stream, not globally across all operation types.

RepTree encapsulates range handling in a dedicated `StateVector` class and exposes the pair through `getStateVectors()`.

### Key Algorithms

#### Incremental Maintenance

Each state vector is updated as operations in that stream are applied or retained for sync:

1. When an operation is applied, its peer ID and counter are extracted
2. The corresponding range array for that peer in the operation stream is located or created
3. The system then either:
   - Extends an existing range if the counter is adjacent to it
   - Merges ranges if extending one range connects it to another
   - Creates a new range if the counter isn't adjacent to any existing range

#### Range Operations

The system includes a `subtractRanges` helper function that calculates the set difference between two range sets. This is used to determine which operations one peer has that another doesn't.

#### Missing Operations Calculation

To determine what operations to send during synchronization:

1. Calculate missing ranges by comparing move state vectors and property state vectors separately
2. Filter move operations and compacted property operations to find those falling within these missing ranges
3. Sort resulting operations within each stream to preserve deterministic ordering

## Benefits

1. **Compact Representation**: Continuous sequences of operations are represented as single ranges
2. **Efficient Synchronization**: Only missing operations are transferred between peers
3. **Handles Gaps**: Non-contiguous operations are efficiently represented as separate ranges
4. **Incremental Updates**: State vectors are maintained as syncable operations are applied
5. **Modular Design**: Separation of concerns with a dedicated StateVector class

## Synchronization Protocol

1. Peer A sends its state vectors to Peer B
2. Peer B calculates missing operations by comparing move and property state vectors
3. Peer B sends only the missing operations to Peer A
4. Peer A applies these operations, automatically updating its state vectors

This approach minimizes network usage and ensures efficient operation transfer during synchronization.

## Usage in RepTree

The state vector functionality in RepTree:

- Is enabled by default
- Can be toggled on/off with the `stateVectorEnabled` property
- Will automatically rebuild from existing operations when re-enabled
- Uses `getStateVectors()` and `getMissingOps(stateVectors)` for range-based synchronization

Property operations are last-writer-wins and are compacted to the latest operation per `(nodeId, key)`. The property state vector represents the retained compacted property operations that can be sent during sync, not a full audit history of every property write.
---

# From docs/reactive-nodes.md:

# Reactive Nodes

RepTree can expose a node as a live JavaScript object so you can read/write properties without thinking about CRDT plumbing.

## Binding a Node

```ts
import { RepTree } from 'reptree';

const tree = new RepTree('peer1');
const root = tree.createRoot();
const v = root.newChild();

const person = v.bind();

person.name = 'Alice'; // persisted to CRDT
person.age = 33;       // persisted to CRDT
person.meta = { nested: { a: 1 }, list: [1, 2, { b: true }] }; // JSON-serializable supported

// If updates arrive from other peers, reads reflect the latest state
console.log(person.name); // 'Alice'
```

### Node properties and methods

Bound nodes expose tree navigation and manipulation via `$`-prefixed properties and methods (following Vue.js convention):

```ts
const bound = v.bind();

// Properties (read-only)
bound.$id            // node ID
bound.$parentId      // parent node ID or null
bound.$parent        // parent Node instance or undefined
bound.$children      // array of child Node instances
bound.$childrenIds   // array of child IDs

// Methods
bound.$moveTo(parent)              // move to new parent (accepts Node, BindedNode, or ID)
bound.$delete()                    // delete node (moves to NULL parent)
bound.$newChild(props)             // create child node
bound.$newNamedChild(name, props)  // create named child node
bound.$observe(listener)           // observe changes, returns unsubscribe function
bound.$observeChildren(listener)   // observe children changes
```

Example usage:

```ts
const folderNode = tree.getNode(folderId);
const folder = folderNode.bind(FolderSchema);

// Create and manipulate children
const file = folder.$newNamedChild('README.md', { size: 1024 });
file.$moveTo(otherFolder);

// Observe changes (batched, ~33ms intervals)
const unobserve = folder.$observeChildren(children => {
  console.log('Children changed:', children.length);
});

// Later: unobserve()
```

All node properties and methods are read-only and cannot be overwritten.

### Field behavior

- `name` is stored directly as `name`.
- `createdAt` is stored as `_c` (ISO string). No auto-conversion on reads/writes via binding; you can store a `Date` in transients and commit it to `_c` yourself if needed.

## Zod v4 Validation (Optional)

You can provide a [Zod v4](https://zod.dev/v4) schema to validate writes and optionally coerce values.

```ts
import { RepTree } from 'reptree';
import { z } from 'zod';

const tree = new RepTree('peer1');
const root = tree.createRoot();
const v = root.newChild();

const Person = z.object({
  name: z.string(),
  age: z.number().int().min(0)
});

const person = v.bind(Person);

person.name = 'Bob'; // ok
person.age = 34;     // ok, validated
// person.age = -1;  // throws
```

**How it works**:
- Bound nodes are Proxies for dynamic property access
- If a schema is provided, writes are validated using field-level validation via `schema.shape`

## Transient writes (drafts)

RepTree supports transient (non‑persistent) overlays for quick UI drafts.

- **useTransient(fn)**: apply transient edits that override reads but do not persist yet.
- **commitTransients()**: promote current transient overlays to persistent values.

```ts
const person = v.bind(Person);

// Draft changes (not yet persistent)
person.$useTransients(p => {
  p.name = 'Alice (draft)';   // transient overlay
  p.age = 34;                 // transient overlay
  p.meta = { draft: true, arr: [1, { x: 2 }] };
});

console.log(person.name); // 'Alice (draft)' — reads include transients

// Promote all transient overlays to persistent CRDT properties
person.$commitTransients();

// Now reads reflect the persisted values even without the overlay
console.log(person.name); // 'Alice (draft)'
```

Notes:

- If a schema is provided, transient writes are validated/coerced the same as persistent writes; `commitTransients()` persists the validated values.
- Persistent writes with a newer operation automatically clear the transient overlay for that key.

## Creating children with normalized props

`node.newChild(props)` and `node.newNamedChild(name, props)` accept plain objects. RepTree will:

- Filter unsupported types (non-primitive objects)
- Ignore `props.name` if `newNamedChild` receives an explicit `name` argument
- Forbid nested children in props for now

```ts
const child = root.newChild({
  name: 'ChildA',
  _c: new Date().toISOString(),
  age: 5,
});
// Stores name, _c, age

const child2 = root.newNamedChild('Folder', { name: 'ignored', flag: true });
// Uses explicit name 'Folder'; props.name is ignored
```

## Integration Notes

- Bound nodes are framework-agnostic JavaScript objects (via Proxy)
- Use your UI framework's preferred state mechanism to manage references to bound nodes

## Notes

- This is opt-in; core remains free of a hard Zod dependency. The helper accepts any schema-like with `safeParse` and optional `shape`.
- For snapshot validation instead of a live object, use `tree.parseNode(id, schema)`.
- Yjs integration is not included in this branch. See `docs/yjs.md` and the `yjs-2025` branch for details.