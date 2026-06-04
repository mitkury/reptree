## **RepTree “Big-Data” Spec — make nodes + ops live off-heap**

**Objective** Lift the hard in-RAM limits that exist today:

* every node lives in a `Map` inside `TreeState` 
* every move op and property op stays in two JS arrays in `RepTree` 

With a few refactors we can page both structures to disk (or remote
storage) and pull only the hot data into the JS heap.

---

### 1 Split the data that must survive between ticks

| Kind of data                                                      | Why it can blow up   | Where it belongs                                |
| ----------------------------------------------------------------- | -------------------- | ----------------------------------------------- |
| **Materialised nodes** (current tree snapshot)                 | millions of nodes    | **`NodeStore`** – one row per node          |
| **Move-ops** (ordering / conflict-res algorithm reads this a lot) | years of edits       | **`MoveLogStore`** – append-only, sequential id |
| **Property-ops** (rarely needed by the move algorithm)            | arbitrary user props | **`PropLogStore`** – append-only                |
| **Secondary indexes** (optional local query acceleration)          | many indexed keys    | **`IndexStore`** – rebuildable local lookup tables |

The durable stores use small CRUD / range-scan contracts and can be
backed by **SQLite, IndexedDB, S3 or HTTP**. `IndexStore` is optional
and rebuildable; it exists to keep secondary queries off the node cache.

---

### 2 Minimal adapter contracts

```ts
interface NodeStore {
  getNode(id: string): Promise<EncodedNode | undefined>;
  putNode(v: EncodedNode): Promise<void>;
  getChildrenPage(parentId: string, afterIdx: number|null, limit: number):
    Promise<Array<{ id: string; idx: number }>>;
}

interface LogStoreLike<T> {
  append(op: T): Promise<number>;          // returns seq
  latestSeq(): Promise<number>;
  scanRange(opts?: { from?:number; to?:number; limit?:number;
                     reverse?:boolean }): AsyncIterable<T>;
}

type MoveLogStore = LogStoreLike<MoveNode>;
type PropLogStore = LogStoreLike<SetNodeProperty>;

interface IndexStore<K = unknown> {
  put(indexName: string, key: K, nodeId: string): Promise<void>;
  delete(indexName: string, key: K, nodeId: string): Promise<void>;
  query(indexName: string, key: K): Promise<string[]>;
  clear(indexName: string): Promise<void>;
}
```

`RepTree` gains a constructor overload:

```ts
new RepTree(peerId, {
  nodeStore,
  moveLog,
  propLog,
  indexStore?,     // optional; falls back to in-memory indexes
  cacheSize?: number   // default 50 000 nodes
})
```

---

### 3 Storage layout (SQLite reference)

```sql
CREATE TABLE rt_nodes(       -- snapshot
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  idx INT,
  payload BLOB
);
CREATE INDEX rt_nodes_pidx ON rt_nodes(parent_id, idx);

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

CREATE TABLE rt_indexes(        -- optional local secondary indexes
  index_name TEXT,
  key BLOB,
  node_id TEXT,
  PRIMARY KEY(index_name, key, node_id)
);
CREATE INDEX rt_indexes_lookup ON rt_indexes(index_name, key);
```

`rt_nodes_pidx` gives **O(page-size)** reads for “fat” child lists with:

```sql
SELECT id, idx
FROM   rt_nodes
WHERE  parent_id = :pid
  AND  (:after IS NULL OR idx > :after)
ORDER  BY idx
LIMIT  :limit;
```

---

### 4 Code-path changes (internal)

| Part              | Old code                                 | New code                                                                                              |
| ----------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Node fetch**  | `TreeState.getNode(id)`                | `await cacheOrStore(id)` → writes to `TreeState` only when loaded                                     |
| **Child list**    | sync array in `NodeState.children`     | `async *children()` returns pages from `NodeStore.getChildrenPage`                                  |
| **Logging an op** | push into `moveOps[] / setPropertyOps[]` | `await moveLog.append(op)` or `propLog.append(op)`                                                    |
| **Conflict loop** | iterates `moveOps[]`                     | same, but `moveOps[]` is filled by a **fold worker** that streams new rows from `moveLog.scanRange()` |
| **Index query**   | lookup local JS map                      | `await indexStore.query(name, key)` returns ids; hydrate cache misses with `NodeStore.getNode(id)`     |

A tiny **LRU** (default 50 000 nodes ≈ < 4 MB) shields the stores from
thrashy hot loops:

```ts
const verts = new LRU<string, EncodedNode>({ max: cacheSize });
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

* Nodes and ops live on disk or a remote service; RAM stays small.
* Secondary indexes can also live off-heap; querying an index does not require loading the full tree.
* Existing move-conflict algorithm continues to operate in memory on
  just the necessary slice of the move log.
* Library consumers keep the same conceptual model—just sprinkle `await`
  when they deal with big data.
