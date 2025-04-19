# Virtual File‑System (RepTree) vs. Native File System

Date: 2025‑04‑19  
Status: Draft

| Aspect | Native FS (ext4 / APFS / NTFS) | RepTree Virtual FS |
|--------|--------------------------------|--------------------|
| **Latency** | Microsecond‑level metadata; millisecond disk I/O | Microseconds for in‑RAM ops; snapshot flush in the background |
| **Throughput** | Streams at disk speed (GB/s on SSD) | In‑RAM for metadata, same disk/S3 speed for blobs |
| **Crash safety** | Depends on journal & single‑machine scope | Snapshot + append‑log; converges across machines after power loss |
| **Concurrent edits** | Requires locks or merge tools | Built‑in CRDT, automatic conflict‑free merge |
| **Offline & sync** | Needs rsync/Dropbox/Git | Range‑vector diff; works offline by design |
| **Moves / renames** | Cheap but race‑prone across devices | `moveVertex` keeps history; zero lost‑update risk |
| **Large directories** | Millions of entries, O(log n) lookup | Fast to ~100 k; needs sharding beyond that |
| **Tool compatibility** | Universal (`ls`, editors, shell) | Needs API bridge or FUSE mount |
| **Atomic batches** | Only `rename()` truly atomic | Any op batch stays atomic & mergeable |
| **Storage overhead** | Minimal | Snapshot + log ≈ 30‑40 % before gzip |
| **Security / ACLs** | Kernel‑enforced | User‑land vertex ACLs |
| **Binary deltas** | Copy‑on‑write rarely built‑in | Treat blobs immutable; no diffing |
| **GC / versioning** | External tools (git, trash) | Cheap branching & time‑travel snapshots |
| **Debuggability** | Mature ecosystem | Requires custom inspectors |

---

## When the RepTree Virtual FS is Better

* Multi‑device, **offline‑first** workflows.
* Real‑time **collaboration** where edits and renames happen concurrently.
* Applications that embed rich metadata, branching, or custom document types.

## When the Native FS is Better

* Massive binary data or databases that must **stream at disk speed**.
* Need for **shell tools**, OS‑level permissions, or integration with existing system services.
* **Single‑machine** projects where merge conflicts are rare.

---

### TL;DR

The virtual file system trades raw I/O throughput and universal tool support for rock‑solid conflict‑free collaboration, cheap synchronization, and application‑level flexibility. Use it for documents that move between devices and editors; keep the native file system for heavyweight assets and legacy tooling.
