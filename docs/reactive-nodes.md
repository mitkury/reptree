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