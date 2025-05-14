## **RepTree “Big-Data” Spec — make vertices + ops live off-heap**

**Objective** Lift the hard in-RAM limits that exist today:

* every vertex lives in a `Map` inside `TreeState` 
* every move op and property op stays in two JS arrays in `RepTree` 

With a few refactors we can page both structures to disk (or remote
storage) and pull only the hot data into the JS heap.

---

### 1 Split the data that must survive between ticks

| Kind of data                                                      | Why it can blow up   | Where it belongs                                |
| ----------------------------------------------------------------- | -------------------- | ----------------------------------------------- |
| **Materialised vertices** (current tree snapshot)                 | millions of nodes    | **`VertexStore`** – one row per vertex          |
| **Move-ops** (ordering / conflict-res algorithm reads this a lot) | years of edits       | **`MoveLogStore`** – append-only, sequential id |
| **Property-ops** (rarely needed by the move algorithm)            | arbitrary user props | **`PropLogStore`** – append-only                |

The three stores all implement the same low-level CRUD / range scan
interface but can be backed by **SQLite, IndexedDB, S3 or HTTP**.

---

### 2 Minimal adapter contracts

```ts
interface VertexStore {
  getVertex(id: string): Promise<EncodedVertex | undefined>;
  putVertex(v: EncodedVertex): Promise<void>;
  getChildrenPage(parentId: string, afterIdx: number|null, limit: number):
    Promise<Array<{ id: string; idx: number }>>;
}

interface LogStoreLike<T> {
  append(op: T): Promise<number>;          // returns seq
  latestSeq(): Promise<number>;
  scanRange(opts?: { from?:number; to?:number; limit?:number;
                     reverse?:boolean }): AsyncIterable<T>;
}

type MoveLogStore = LogStoreLike<MoveVertex>;
type PropLogStore = LogStoreLike<SetVertexProperty>;
```

`RepTree` gains a constructor overload:

```ts
new RepTree(peerId, {
  vertexStore,
  moveLog,
  propLog,
  cacheSize?: number   // default 50 000 vertices
})
```

---

### 3 Storage layout (SQLite reference)

```sql
CREATE TABLE rt_vertices(       -- snapshot
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  idx INT,
  payload BLOB
);
CREATE INDEX rt_vertices_pidx ON rt_vertices(parent_id, idx);

CREATE TABLE rt_move_ops(       -- move log
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts  INTEGER, peer TEXT,
  target_id TEXT, parent_id TEXT
);

CREATE TABLE rt_prop_ops(       -- property log
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts  INTEGER, peer TEXT,
  target_id TEXT, key TEXT,
  value BLOB, transient INT
);
```

`rt_vertices_pidx` gives **O(page-size)** reads for “fat” child lists with:

```sql
SELECT id, idx
FROM   rt_vertices
WHERE  parent_id = :pid
  AND  (:after IS NULL OR idx > :after)
ORDER  BY idx
LIMIT  :limit;
```

---

### 4 Code-path changes (internal)

| Part              | Old code                                 | New code                                                                                              |
| ----------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Vertex fetch**  | `TreeState.getVertex(id)`                | `await cacheOrStore(id)` → writes to `TreeState` only when loaded                                     |
| **Child list**    | sync array in `VertexState.children`     | `async *children()` returns pages from `VertexStore.getChildrenPage`                                  |
| **Logging an op** | push into `moveOps[] / setPropertyOps[]` | `await moveLog.append(op)` or `propLog.append(op)`                                                    |
| **Conflict loop** | iterates `moveOps[]`                     | same, but `moveOps[]` is filled by a **fold worker** that streams new rows from `moveLog.scanRange()` |

A tiny **LRU** (default 50 000 nodes ≈ < 4 MB) shields the stores from
thrashy hot loops:

```ts
const verts = new LRU<string, EncodedVertex>({ max: cacheSize });
```

---

### 5 Background fold workers

Two independent async loops keep the snapshot table in step:

```ts
async function foldMoves() {
  for await (const m of moveLog.scanRange({ from: lastSeq+1 })) {
    applyMoveSnapshot(m);            // same logic as today
    lastSeq = m.seq;
  }
}
async function foldProps() { … }
```

They run in a timer (browser) or a worker thread (Node).

---

### 6 Public API impact

* All methods that might hit storage become **async** (`Promise` or
  async iterator).
  *Example*:

  ```ts
  const root = await tree.createRoot();
  for await (const v of root.children()) console.log(v.id);
  ```

* No user-facing undo API is added (internal algorithm unchanged).

---

### 7 Migration path (incremental, low-risk)

1. **Add adapters & in-memory implementations** — nothing breaks.
2. **Flip reads/writes to `await`**; update tests.
3. **Insert LRU + async loaders**; TreeState becomes just a cache.
4. **Add SQLite adapter**; hook fold workers.
5. **Replace `children` getter with async iterator**; keep a
   deprecated helper that loads one page for old callers.

Ship each step behind a feature flag until the ecosystem catches up.

---

### 8 Result

* Vertices and ops live on disk or a remote service; RAM stays small.
* Existing move-conflict algorithm continues to operate in memory on
  just the necessary slice of the move log.
* Library consumers keep the same conceptual model—just sprinkle `await`
  when they deal with big data.