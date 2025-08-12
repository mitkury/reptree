# Reactive Vertices

RepTree can expose a vertex as a live JavaScript object so you can read/write properties without thinking about CRDT plumbing. Reads reflect the latest CRDT state; writes persist via `setVertexProperty`.

## Binding a Vertex

```ts
import { RepTree, bindVertex } from 'reptree';

const tree = new RepTree('peer1');
const root = tree.createRoot();
const v = root.newChild();

const person = bindVertex(tree, v.id);

person.name = 'Alice'; // persisted to CRDT
person.age = 33;       // persisted to CRDT

// If CRDT updates elsewhere, reads reflect the latest state
console.log(person.name); // 'Alice'
```

## Zod v4 Validation (Optional)

You can provide a [Zod v4](https://zod.dev/v4) schema to validate writes and optionally coerce values.

```ts
import { z } from 'zod';
import { bindVertex } from 'reptree';

const Person = z.object({
  name: z.string(),
  age: z.number().int().min(0)
});

const person = bindVertex(tree, v.id, Person);

person.name = 'Bob'; // ok
person.age = 34;     // ok, validated
// person.age = -1;  // throws
```

- The returned object is a Proxy that forwards reads/writes to the vertex.
- If a schema is provided, it validates writes. Field-level validation is used when available via `schema.shape`, otherwise a safe whole-object validation is attempted.

## Svelte 5 Integration

Svelte 5 can wrap the reactive object in a state:

```ts
<script lang="ts">
  import { RepTree, bindVertex } from 'reptree';
  import { z } from 'zod';

  const tree = new RepTree('peer1');
  const root = tree.createRoot();
  const v = root.newChild();

  const Person = z.object({ name: z.string(), age: z.number().int().min(0) });
  const person = bindVertex(tree, v.id, Person);

  const personState = $state(person);
</script>

<input bind:value={personState.name} />
<input type="number" bind:value={personState.age} />
```

As the user edits the inputs, the underlying vertex is updated and persisted. If CRDT updates arrive from other peers, the bound values reflect them on read.

## Notes

- This is opt-in; core remains free of a hard Zod dependency. The helper accepts any schema-like with `safeParse` and optional `shape`.
- For snapshot validation instead of a live object, use `tree.parseVertex(id, schema)`.
- Yjs documents are supported as vertex properties; you can bind them separately using Yjs APIs.