# Virtual File‑System Layer on Top of RepTree

Date: 2025‑04‑19  
Status: Draft

## 1 — Why

Provide an **in‑RAM, CRDT‑friendly file system** for Sila workspaces and other applications that embed RepTree.  
Let every "file" use the storage model that fits it best:

* **Editable** → CRDT (RepTree with optional Yjs properties).  
* **Immutable** → blob in S3 or local file‑system.

---

## 2 — Vertex schema in the root *FS tree*

| `type`       | Required props                              | Meaning                                          |
|--------------|---------------------------------------------|--------------------------------------------------|
| `dir`        | —                                           | Folder / namespace                               |
| `file‑tree`  | `treeId` – UUID of RepTree                  | Editable document (text, structured, etc.)       |
| `file‑blob`  | `url` or `hash`                             | Immutable binary (image, model, etc.)            |
| `mount`      | `treeId`                                    | Mount another entire RepTree under this vertex   |

Other metadata (name, icons, size, timestamps…) remain normal vertex properties.

---

## 3 — Global addressing

```
fsVertexId              # dirs, mounts, blobs
fsVertexId:innerId      # nodes inside linked RepTree
```

Simple string split → no extra lookup tables.

---

## 4 — Runtime components

### 4.1 `TreeManager`

```ts
class TreeManager {
  private cache = new LRU<string, RepTree>(MAX_OPEN);
  private preloadQueue = new PriorityQueue<string>(); // For cache warming

  async openTree(treeId: string): Promise<RepTree>;
  async unload(treeId: string): Promise<void>;  // snapshot + flush log
  preloadTree(treeId: string, priority: number): void; // Mark for preloading
}
```

* Holds **only "hot" trees** in memory.  
* On `file‑tree` open → `openTree(treeId)`.  
* Evicts least‑recently‑used trees to keep RAM predictable.
* Optional preloading of frequently accessed trees.

### 4.2 Path resolver

1. Walk the FS tree (`dir`, `mount`) synchronously.  
2. On `file-tree` vertex → `openTree(treeId)` if needed.  
3. Continue walk inside that tree if `innerPath` is present.

### 4.3 Persistence formats

| Kind         | On‑disk / remote format                   | Snapshot trigger                |
|--------------|-------------------------------------------|---------------------------------|
| FS tree      | `snapshot.json.gz` + `ops.log`            | every 2 k ops or 1 MB           |
| RepTree doc  | same as above                             | every 2 k ops or 1 MB           |
| Blob         | raw file in S3/local path                 | immutable, write‑once           |

CRC‑32 footer on every snapshot chunk.

---

## 5 — Sync protocol between peers

1. Exchange **range‑based state vectors** (see `generate-range-based-state-vector.md`).  
2. Send only missing ops per tree, preferring delta updates when possible.  
3. Blobs rely on object‑version keys for deduplication.

---

## 6 — Common operations

| FS action         | Effect                                                               |
|-------------------|----------------------------------------------------------------------|
| Create dir        | `newVertex(parentId)` with `type: "dir"`                             |
| Create file       | allocate `treeId` or upload blob, then vertex with `type: "file-*"`  |
| Move / rename     | simply `moveVertex` or property update in FS tree                    |
| Delete            | call `deleteVertex()` which uses RepTree's void vertex approach      |
| Copy file         | duplicate vertex and storage as needed                               |
| Cross‑file move   | copy‑then‑delete once both docs are loaded                           |
| Recover deleted   | retrieve from void vertex if within recovery window                  |

---

## 7 — Performance knobs

* `MAX_OPEN` (default 10) — max trees held in the LRU cache.  
* Snapshot thresholds (`OPS_PER_SNAPSHOT`, `MAX_SNAPSHOT_BYTES`).  
* Hybrid child‑storage (see `reptree-vertices-with-lots-of-children.md`) for huge dirs.
* `PRELOAD_QUEUE_SIZE` (default 5) — number of trees to keep in preload queue.

---

## 8 — Fault tolerance

* Unknown op types → safely skip.  
* Periodic verification of data integrity for critical trees.
* Extend existing fuzz tests to cover open/close cycles while editing.

---

## 9 — Yjs Integration

To support rich text editing and collaborative data structures, RepTree will use the Yjs properties specification (see `yjs-properties-spec.md`):

* Any vertex property can be a Yjs document (text, map, array, etc.).
* This allows files to contain richly collaborative content without a separate file type.
* Delta updates optimize network traffic for property changes.
* Example: A markdown document would be a file-tree with a "content" property containing a Yjs text document.

---

## 10 — Versioning and Permissions

* **Versioning**: Each RepTree has a `version` property for tracking document revisions.
* **Time Travel**: Ability to open a tree at a specific version or timestamp.
* **Permissions**: Vertex-level permission model with inheritance from parent vertices.
* **Access Control**: Read/write/admin permissions per vertex, with default inheritance.

---

## 11 — Open questions

* Background blob garbage‑collection policy.
* Optimal cache eviction strategies for heavily nested trees.
* Cross-tree reference integrity management.

---

### Next steps

1. Implement **TreeManager** + LRU cache.  
2. Add helper API on `Vertex` (`asFile()`, `asDir()`, …).  
3. Integrate Yjs property types from the specification.
4. Integration tests: open 100 files, random edits, eviction.  
5. Update README with a quick‑start "open a file, edit text, close" example.
