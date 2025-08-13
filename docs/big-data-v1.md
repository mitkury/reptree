## RepTree v1: External Storage and Async Loading (Node/SQLite)

### Overview
RepTree now supports paging vertices and operations outside of the JS heap while keeping a hot working set in memory. This enables very large trees and long histories without exhausting RAM.

- Optional external stores for vertices and op logs (Node-friendly; SQLite adapter included)
- Keep only the last N ops in memory (`opMemoryLimit`), persist everything else to a log
- Lazy loading of children/vertices via new async helpers
- Backward compatible: existing synchronous API continues to work for v1

This work is aligned with the internal proposals in `docs/dev/proposals/reptree-vertices-with-lots-of-children.md` and `docs/dev/proposals/big-trees/big-trees.md`.

### What’s new
- Storage adapters (exported from `src/index.ts`):
  - `MemoryVertexStore`, `MemoryLogStore<T>` — in-memory reference adapters
  - `SqliteVertexStore`, `SqliteJsonLogStore<T>`, `ensureRepTreeSchema(db)` — SQLite-backed (Node)
- RepTree optional constructor overload:
  - `new RepTree(peerId, opts?, ops?)`
  - `opts`:
    - `vertexStore?: VertexStore`
    - `moveLog?: LogStoreLike<MoveVertex>`
    - `propLog?: LogStoreLike<SetVertexProperty>`
    - `opMemoryLimit?: number` — keep only the last N ops in memory
- Async read helpers (non-breaking additions):
  - `getVertexAsync(vertexId)`
  - `getChildrenAsync(vertexId)`, `getChildrenIdsAsync(vertexId)`
  - `getVertexPropertyAsync(vertexId, key)`, `getVertexPropertiesAsync(vertexId)`
  - `getMissingOpsAsync(stateVector)` streams from external logs if needed
- Persistence hooks (fire-and-forget): when you call `moveVertex`/`setVertexProperty`, the op is appended to external logs if provided; vertex snapshots update the external `vertexStore` to support paging

### Quick start
#### 1) Memory-backed (demonstrates the API shape)
```ts
import { RepTree, MemoryVertexStore, MemoryLogStore } from 'reptree';

const tree = new RepTree('peer1', {
  vertexStore: new MemoryVertexStore(),
  moveLog: new MemoryLogStore(),
  propLog: new MemoryLogStore(),
  opMemoryLimit: 10_000,
});

const root = tree.createRoot();
root.newNamedChild('Docs');

// Sync reads (fast path from in-memory cache)
const children = root.children;

// Async reads (recommended when using external stores)
const childrenAsync = await root.childrenAsync();
```

#### 2) SQLite-backed (Node, e.g., better-sqlite3)
```ts
import Database from 'better-sqlite3';
import {
  RepTree,
  SqliteVertexStore,
  SqliteJsonLogStore,
  ensureRepTreeSchema,
} from 'reptree';

const db = new Database('reptree.db');
ensureRepTreeSchema(db);

const tree = new RepTree('peer1', {
  vertexStore: new SqliteVertexStore(db),
  moveLog: new SqliteJsonLogStore(db, 'rt_move_ops'),
  propLog: new SqliteJsonLogStore(db, 'rt_prop_ops'),
  opMemoryLimit: 50_000,
});

const root = tree.createRoot();
root.newNamedChild('Images');

// Lazy children paging (if not already in memory)
const ids = await tree.getChildrenIdsAsync(root.id);
```

### Sync vs Async API
- v1 keeps the current synchronous public API intact. Your existing code and tests do not need to change.
- New async helpers are additive and recommended when you rely on external storage for large trees:
  - Sync methods read from the in-memory snapshot.
  - Async methods can page data from the external store when it’s not already in memory.
- Under the hood, writes also persist to the provided stores/logs, but this is fire-and-forget and does not change sync semantics.

### State-vector sync with external logs
When using state vectors, you can stream missing ops from logs:
```ts
const theirs = otherTree.getStateVector();
if (theirs) {
  const missingOps = await tree.getMissingOpsAsync(theirs);
  otherTree.merge(missingOps);
}
```

### Evicting old ops from memory
If `opMemoryLimit` is set, RepTree keeps only the newest N ops in memory, while all operations remain available in the external logs:
```ts
const tree = new RepTree('peer1', { moveLog, propLog, opMemoryLimit: 10_000 });
```

### Migration path
- Today (v1):
  - Use the same synchronous API as before; opt into external stores/adapters when needed.
  - Use the async helpers if you want to page children/vertices or stream ops from storage.
- Future steps (behind flags):
  - Make more reads return async types by default when stores are present.
  - Introduce background fold workers and LRU caches for even larger datasets.

### Test impact
- No test updates required for v1: the synchronous surface remains, and all current tests pass unchanged.
- If you adopt the async helpers in your application code, add `await` accordingly in your own tests.

### Notes & limitations
- The SQLite adapter stores ops as JSON for simplicity in v1.
- The vertex snapshot in `vertexStore` captures `id` and `parentId` (optional `idx`/`payload` placeholders). This is sufficient to page children and materialize vertices on demand.
- You can implement your own `VertexStore`/`LogStoreLike<T>` to back RepTree with other databases or remote services.