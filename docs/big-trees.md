## RepTree Big Trees (v1): External Storage + Async Loading

### Why
Large trees and long edit histories can exceed the JS heap if all vertices and ops live in memory. v1 lets you page both to storage (Node-ready), while keeping a small hot working set in memory.

### What’s in v1
- Optional external adapters (Node)
  - Vertex snapshot store (`VertexStore`) — to materialize parent/child relations and page children
  - Append-only logs (`LogStoreLike<T>`) — to persist move and property ops
- In-memory window for ops
  - Keep newest N ops in memory via `opMemoryLimit`
  - Persist all ops to logs so you can stream older ones when needed
- Async read helpers (additive)
  - `getVertexAsync`, `getChildrenAsync`, `getChildrenIdsAsync`
  - `getVertexPropertyAsync`, `getVertexPropertiesAsync`
  - `getMissingOpsAsync(stateVector)` streams missing ops from logs
- Backward compatible API
  - Sync methods still work (read from in-memory snapshot)
  - Async methods page from storage when data is not already in memory

### How it fits the CRDT
- CRDT conflict resolution is unchanged (move-CRDT for structure, LWW/Yjs for properties)
- Correctness for moves: applying an old move may require “newer-than-op” moves for undo/do/redo
  - v1: if those “newer-than-op” moves are not in memory, stream them from the move log first (via `getMissingOpsAsync`)
- Properties are LWW (or Yjs deltas), so eviction of old property ops doesn’t affect correctness

### Quick start (SQLite)
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
root.newNamedChild('Docs');

// Async paging (loads from storage on demand)
const children = await root.childrenAsync();
```

### What we deliberately did not change (yet)
- In-memory children remain arrays for simplicity
- No background fold workers yet (v1 is fully synchronous in the app thread)
- No automatic paging iterator on vertices (we provide helper methods instead)

### What we’d like to add next (proposed roadmap)
- Many-children optimization (in-memory)
  - Hybrid strategy: arrays for small child sets, maps for mid-size, and page-backed lists for very large sets
  - Configurable page size and thresholds
  - Consistent O(page-size) iteration and faster lookups
- First-class children pagination API
  - `async *children(parentId, opts)` yielding pages (cursor-based)
  - Optional name/index ordering with storage-backed indices
- Background fold workers (browser/Node)
  - Continuously stream and apply logs to keep snapshot warm
  - Small LRU cache for hot vertices (configurable max)
- Automatic fetch for undo/do/redo
  - When an older move arrives and the “newer-than-op” set is not fully in memory, auto-fetch the missing slice from logs 
  - Today exposed via `getMissingOpsAsync`; next step is to integrate fetching into the internal apply path
- Compaction & snapshots
  - Periodic snapshotting of materialized vertices to reduce replay times
  - Optional log compaction for Yjs (merge deltas) and property ops (keep last-writer)
- Indexes for access patterns
  - Name/path index (e.g., `_n`) with storage-backed search
  - Application-defined secondary indexes
- Reliability & recovery
  - Invariants + repair: ensure parent pointers and children sets are consistent; detect and fix drift during folding
  - Crash-safe writes with WAL (where supported by storage)
- Performance and scale tests
  - Multi-million vertex trees, multi-year move logs
  - Stress tests for paging, eviction, and fold workers

### Notes & limitations
- SQLite adapter stores ops as JSON for v1 simplicity
- `vertexStore` keeps `id` and `parentId` (plus optional `idx`/`payload`) — enough to page children and materialize vertices
- You can implement custom stores (S3, Postgres, HTTP) by adhering to the simple adapter interfaces

### Links
- Proposals: see `docs/dev/proposals/reptree-vertices-with-lots-of-children.md` and `docs/dev/proposals/big-trees/big-trees.md`
- Tests cover:
  - Many-children paging from SQLite
  - Vector sync using async log streaming with eviction
  - Yjs property ops streaming via SQLite prop log
  - Forcing storage fetch when `opMemoryLimit` is tiny