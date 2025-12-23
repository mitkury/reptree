# RepTree-C: C core for huge trees (WASM + native)

## Goal

Make RepTree handle **millions of vertices** and **years of ops** while running:

- in the browser (via **WebAssembly**, ideally inside a Worker)
- on mobile/desktop/server (via **native C**: shared library, static lib, etc.)

This proposal focuses on a **C “core engine”** that is storage-aware, memory-efficient, and callable from JS/TS (WASM) or any host runtime (native).

Related proposals:
- `docs/dev/proposals/big-trees/big-trees.md` (page data off-heap / into stores)
- `docs/dev/proposals/big-trees/reptree-in-rust.md` (thin JS API + native core)
- `docs/dev/proposals/reptree-vertices-with-lots-of-children.md` (large child lists)
- `docs/dev/proposals/async-move-ops-background-fetching.md` (streaming ops in the background)
- `docs/dev/proposals/ids-optimization.md` (ID interning)
- `docs/dev/proposals/indexing.md` (local secondary indexes)
- `docs/dev/proposals/operation-pruning.md`, `docs/dev/proposals/state-json-and-incremental-ops.md` (log growth / incremental state)

---

## Non-goals (for v1)

- Replacing the CRDT semantics (move tree + LWW props) with a different CRDT.
- A full embedded SQL engine in C (we can integrate one later, but don’t depend on it).
- A new public JS API. The first target is: **same JS ergonomics**, different core.

---

## Why C (vs JS / Rust)

- **WASM portability**: C compiles cleanly to WASM with small runtime requirements.
- **Predictable memory layout**: SoA/AoS choices, arenas, custom allocators, off-heap buffers.
- **Host flexibility**: embed in games, native apps, server processes, runtimes without Rust toolchains.

Tradeoffs:
- more careful safety work (fuzzing, sanitizers, invariants, test vectors)
- fewer “free” high-level data structures → we must define formats + memory ownership explicitly

---

## Core idea

Move RepTree’s heavy state into a native core with:

- **append-only op logs** (move ops + prop ops)
- a **materialized snapshot** (vertex rows + property rows) that can be rebuilt/folded
- **paged access** for hot queries (children pages, property pages)
- **compact IDs** (interned strings → 32-bit/64-bit IDs)
- a **thin JS facade** that keeps only a small LRU cache of “hot” vertices and exposes reactive binding

This aligns with the “Big-Data Spec” but makes the “stores” a first-class part of the engine, with C-level formats that are efficient across native and WASM.

---

## High-level architecture

```
 JS main thread
 ┌───────────────────────────┐
 │ RepTree (TS facade)        │  (cache + proxies + ergonomics)
 │ - optimistic edits         │
 │ - subscriptions            │
 └──────────────┬────────────┘
                │ (postMessage / direct WASM calls)
                ▼
 Worker thread (recommended in browser)
 ┌──────────────────────────────────────────────┐
 │ RepTree-C (WASM/native)                       │
 │ - move CRDT engine                            │
 │ - LWW property engine                         │
 │ - storage adapters (snapshot + logs + indexes)│
 │ - batch folding + compaction                  │
 └──────────────────────────────────────────────┘
```

Native (non-browser) uses the same C core via an FFI boundary:

- Node: N-API addon (or plain C ABI + `ffi-napi`)
- Swift/Kotlin/C#/Python: standard C ABI bindings
- Tauri: plugin calling C library

---

## Data model changes (internal)

### 1) Interned IDs everywhere

All repeated strings become interned numeric IDs inside the engine:

- `peer_id` → `peer_u32`
- `vertex_id` (UUID string) → `vid_u64` (or `vid_u128` if truly needed)
- property keys (strings) → `key_u32`

The engine maintains string tables:

- `string_pool`: a single bump-allocated blob + hash table of offsets
- stable mapping: `string → u32` (and optional reverse mapping for debugging)

Benefits:
- drastic memory cut (similar to `ids-optimization.md` but extended to *everything*)
- faster comparisons (integer compare)
- smaller serialized ops (varints)

### 2) Split snapshot vs history

We separate:

- **snapshot tables** (current view): vertex rows, property rows, child adjacency
- **op logs**: move ops + property ops (append-only)

The public API can still expose “get all ops” for sync, but the *engine* stops relying on “keep all ops in JS arrays”.

### 3) Children: page-based adjacency, not JS arrays

For vertices with huge child lists, “children as a JS array” becomes a liability.

Core representation becomes paged:

- each parent has a “child index” that supports:
  - `insert/move/remove`
  - `seek(after_cursor, limit)` → returns child IDs in order
  - stable cursors (to support UI pagination)

Implementation options (core supports one initially, abstracts the rest):

- **B+tree-like pages** keyed by `(parent_vid, position_key)` (recommended)
- **chunked vectors** (good start; degrade gracefully into B+tree when large)
- **skiplist** (good for in-memory; more complex for persistence)

The important shift: children become an **iterator/page API**, not “always materialize all children”.

---

## Storage interface (C core)

The C core should not require a particular backend. Instead it depends on a small “store vtable”.

### Stores

- **MoveLogStore**: append + scan by range (by peer and/or global sequence)
- **PropLogStore**: append + scan by range
- **SnapshotStore**: point reads/writes of vertex + property state, and child pages
- (optional) **IndexStore**: secondary index tables

### Minimal C “vtable” sketch

```c
typedef struct rt_store_vtbl {
  // Move log
  int (*move_append)(void* ctx, const uint8_t* bytes, size_t len, uint64_t* out_seq);
  int (*move_scan)(void* ctx, uint64_t from_seq, uint64_t to_seq,
                   int (*on_item)(void* uctx, const uint8_t* bytes, size_t len),
                   void* uctx);

  // Prop log
  int (*prop_append)(void* ctx, const uint8_t* bytes, size_t len, uint64_t* out_seq);
  int (*prop_scan)(void* ctx, uint64_t from_seq, uint64_t to_seq,
                   int (*on_item)(void* uctx, const uint8_t* bytes, size_t len),
                   void* uctx);

  // Snapshot (vertex + props + children pages)
  int (*vertex_get)(void* ctx, uint64_t vid, uint8_t** out, size_t* out_len);
  int (*vertex_put)(void* ctx, const uint8_t* bytes, size_t len);
  int (*children_page_get)(void* ctx, uint64_t parent_vid,
                           const uint8_t* cursor, size_t cursor_len,
                           uint32_t limit,
                           uint8_t** out, size_t* out_len);
} rt_store_vtbl;
```

WASM build notes:
- direct disk I/O is not available; the store is typically implemented in JS using **IndexedDB**.
- the “store vtable” becomes imported JS functions or a message bridge to a JS storage worker.

Native build notes:
- store can be memory-only, mmap-backed, SQLite/RocksDB-backed, custom app storage, etc.

---

## Serialization formats (ops + snapshot)

To minimize bridge overhead (WASM <-> JS) and storage size:

- define a **binary** serialization for ops and snapshot rows
- use varints + length-prefixing for compactness

### Operations

Move op (conceptual):

- `op_id`: `(peer_u32, counter_u32)` or `(peer_u32, counter_u64)`
- `target_vid`
- `parent_vid` (0 sentinel for NULL parent)
- `meta` (optional, future)

Property op:

- `op_id`
- `target_vid`
- `key_u32`
- value: typed JSON-ish encoding (null/bool/number/string/bytes/object/array)
- transient flag (optional)

Important: For “huge trees”, objects/arrays can be big; the proposal should allow:
- storing large JSON values as **blobs** (e.g., CBOR) without parsing on every read
- partial read strategies later (not required for v1)

### Snapshot rows

Vertex snapshot row:
- `vid`, `parent_vid`, `tombstone`, plus child-index root pointer (if persisted)

Property snapshot row:
- `(vid, key_u32) → { lww: op_id, value_blob }`

---

## Engine execution model

### 1) Apply pipeline

When the core receives an op:

1. **decode** (binary → struct)
2. **validate** basic invariants (IDs exist, no obvious corruption)
3. **append to log**
4. **apply to in-memory “hot state”** (optional)
5. emit a **patch** describing what changed (for UI caches)

### 2) Background folding (materialization)

To avoid “replay from genesis” on startup:

- fold ops into the snapshot in batches
- persist snapshot + fold watermark (last processed seq per log)

Native:
- background thread can fold continuously or on a cadence.

WASM:
- fold in a Worker event loop in time-sliced batches to avoid blocking.

### 3) Compaction (optional, but important for huge trees)

Over time, logs grow. Provide compaction modes:

- **snapshot checkpoint**: persist snapshot + watermarks; allow discarding older ops *locally*
- **op pruning**: if a peer has acknowledged (via state vectors) that all peers have ops ≤ watermark, safe to prune local history (see `operation-pruning.md`)

Sync semantics remain “ops are the source of truth across peers”; pruning is a **local storage optimization** and must be gated by explicit app policy.

---

## Query and indexing strategy

### Core queries (must be fast)

- `get_vertex(vid)` (point lookup)
- `get_children_page(parent_vid, cursor, limit)`
- `get_props(vid)` or `get_prop(vid, key)`
- `get_missing_ops(state_vector)` (sync)

### Optional secondary indexes

Following `indexing.md`, indexes are best treated as *local* and rebuildable:

- property equality index: `(key_u32, value_hash) → [vid...]`
- full-text index: token → vids
- custom index: callback-based indexing (host provides mapKey function; core stores results)

For v1 in C, keep it simple:
- implement “property equality index” + “custom index with explicit key list” as primitives
- leave full-text to the host (or to a later iteration)

---

## JS/TS API shape (thin facade)

The TS layer keeps the current ergonomics:

- `Vertex` objects (or proxies) remain the main UX surface
- `bind()` remains (reactive proxy backed by cached reads + patches)
- `observe()` remains (subscription-based, batched)

### What changes (publicly visible)

For huge trees, we likely need **new optional APIs**, while keeping existing ones:

- `vertex.children` (current) may remain for small lists, but should be discouraged for huge lists
- add `vertex.childrenPage({ cursor, limit })` and/or `vertex.childrenIterator()`
- add `tree.prefetchChildren(parent, opts)` to warm caches

We can keep backward compatibility by:
- returning a truncated list + warning in dev mode
- or making `children` lazily fetch the first page only (documented)

---

## C API surface (host-facing)

Two entry points:

1) **Pure C ABI** (stable, easiest for any language)
2) **WASM exports** (thin wrappers over the same ABI)

Example (conceptual):

- `rt_create(peer_string, store_vtbl, store_ctx) -> rt_handle*`
- `rt_apply_op(handle, op_bytes, op_len, out_patch_bytes*)`
- `rt_get_vertex(handle, vid, out_bytes*)`
- `rt_get_children_page(handle, parent_vid, cursor_bytes, cursor_len, limit, out_bytes*)`
- `rt_get_state_vector(handle, out_bytes*)`
- `rt_get_missing_ops(handle, their_state_vector_bytes, out_ops_bytes*)`

Memory ownership rule:
- all `out_bytes` are allocated by core and freed by `rt_free(buf)` (or a provided allocator)

---

## Migration plan (incremental)

### Phase 0 — define formats + golden test vectors

- specify op encoding and snapshot encoding (docs + reference implementation)
- create “golden files” from the current TS implementation:
  - apply a sequence of ops → expected snapshot + state vector

### Phase 1 — in-memory C core (no persistence)

- implement move CRDT + LWW props in C
- implement in-memory stores (vector logs + hash tables)
- run the existing Vitest suite against:
  - current TS engine
  - new C engine via a TS wrapper

### Phase 2 — storage adapter + paging

- implement SnapshotStore + child paging
- implement IndexedDB adapter (browser) in TS/JS
- implement a simple file-backed store for Node (append-only + mmap optional)

### Phase 3 — compaction + indexes + performance hardening

- snapshot checkpointing
- optional pruning policy
- property equality indexes
- fuzzing + sanitizers + structured perf benchmarks (`__bench__`)

---

## Expected performance wins

- **Memory**: IDs and keys become integers; fewer JS objects; fewer duplicated strings.
- **CPU**: faster comparisons; less GC pressure; better cache locality in C structures.
- **Huge child lists**: paging makes “list children” scale with page size, not total children.
- **Startup time**: snapshot-based load avoids full replay; incremental folding keeps snapshot current.
- **WASM bridge**: binary op/patch payloads reduce JSON stringify/parse overhead.

---

## Risks and mitigations

- **Correctness risk (C)**: mitigate with shared test vectors, fuzzing, and running the full test suite against both implementations.
- **WASM storage complexity**: mitigate by pushing storage to JS (IndexedDB) behind a clean adapter boundary.
- **API compatibility**: mitigate by keeping current JS API and introducing paging as opt-in additions first.
- **Operational complexity (compaction/pruning)**: mitigate by making pruning an explicit policy and keeping “safe defaults” (never prune ops unless configured).

---

## Open questions

- **Vertex IDs**: keep UUID strings externally but map internally to `vid_u64` (hash) vs store full UUID as 16 bytes.
- **Child ordering key**: reuse current move-tree ordering logic vs adopt a position-key scheme (e.g., fractional indexing / order-statistics tree).
- **Property values**: strict JSON only vs allow opaque blobs (CBOR) as a first-class value type.
- **Threading**: native background fold threads vs explicit “tick” calls for determinism.

---

## Summary

RepTree-C is a path to “big-data RepTree”: a **portable C core** that supports **WASM + native**, keeps JS UX intact, and scales by:

- paging children and snapshot state
- storing ops in append-only logs
- materializing snapshots via background folding
- compacting IDs/keys to integers
- emitting patches for reactive UIs instead of forcing full tree materialization

