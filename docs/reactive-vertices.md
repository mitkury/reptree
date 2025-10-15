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

### Public aliases for internal fields

- name ↔ `_n`
- createdAt ↔ `_c` (stored as ISO string; exposed as Date)

These aliases are applied by default when using `bindVertex` or `vertex.bind()`.

```ts
person.name = 'Alice';              // writes _n = 'Alice'
person.createdAt = new Date();      // writes _c = ISO string
console.log(person.createdAt);      // Date instance
```

You can customize aliasing via options:

```ts
import { defaultAliases } from 'reptree';

const custom = v.bind({
  schema: Person,
  aliases: defaultAliases,
  includeInternalKeys: false,
});
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

## Transient writes (drafts)

RepTree supports transient (non‑persistent) overlays for quick UI drafts.

- **useTransient(fn)**: apply transient edits that override reads but do not persist yet.
- **commitTransients()**: promote current transient overlays to persistent values.

```ts
const person = bindVertex(tree, v.id, Person);

// Draft changes (not yet persistent)
person.useTransient(p => {
  p.name = 'Alice (draft)';   // transient overlay
  p.age = 34;                 // transient overlay
});

console.log(person.name); // 'Alice (draft)' — reads include transients

// Promote all transient overlays to persistent CRDT properties
person.commitTransients();

// Now reads reflect the persisted values even without the overlay
console.log(person.name); // 'Alice (draft)'
```

Notes:

- Aliases apply for transient edits too (e.g., `createdAt` ↔ `_c` with Date↔ISO conversion).
- If a schema is provided, transient writes are validated/coerced the same as persistent writes; `commitTransients()` persists the validated values.
- Persistent writes with a newer operation automatically clear the transient overlay for that key.

## Creating children with normalized props

`vertex.newChild(props)` and `vertex.newNamedChild(name, props)` accept plain objects. RepTree will:

- Map `name` → `_n`, and `createdAt` (Date) → `_c` (ISO string)
- Filter unsupported types (non-primitive objects except Y.Doc)
- Ignore `props.name` if `newNamedChild` receives an explicit `name` argument
- Forbid nested children in props for now

```ts
const child = root.newChild({
  name: 'ChildA',
  createdAt: new Date(),
  age: 5,
});
// Internally stores _n, _c, age

const child2 = root.newNamedChild('Folder', { name: 'ignored', flag: true });
// Uses explicit name 'Folder'; props.name is ignored
```

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