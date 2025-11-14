# RepFS: Collaborative Virtual File System

RepFS is a local-first, CRDT-backed virtual filesystem kernel, embeddable in any JS runtime, with built-in replication, permissions, and time-travel.

## Summary
- Build a standalone, CRDT-backed virtual file system (VFS) that any project can embed to provide multiplayer folder hierarchies, file metadata, and collaborative document editing.
- Use RepTree to model directory structure, metadata, and relationships; keep large payloads in a content-addressed store (CAS) with optional mutable overlays.
- Present a familiar, POSIX-like API (shell commands, Node-style `fs`, WebFileSystem) so agents, services, and end users share a single mental model.
- Keep the system local-first, offline-ready, and cross-platform (Web, desktop, server, mobile) via portable runtimes and pluggable storage adapters.

## Motivation
- **Collaboration parity**: Files, folders, and documents should support concurrent edits from humans and agents without conflicts.
- **Uniform abstraction**: Different apps/projects can expose their state as a filesystem, eliminating bespoke adapters.
- **Agent ergonomics**: Standard commands (`ls`, `cd`, `cat`, `grep`, `applyPatch`) become universal tools for workspace manipulation.
- **Reuse core CRDT infrastructure**: RepTree already provides conflict-free tree updates; leverage it to model filesystem semantics.
- **Extensibility**: Allow third parties to mount their own data sources (cloud storage, APIs) into the same collaborative hierarchy.

## Guiding Principles
- **Structure in RepTree, bytes elsewhere**: Vertices encode hierarchy, metadata, and references; actual file contents live in CAS or pluggable content stores.
- **Local-first**: Every node can operate offline; syncing reconciles via CRDT moves and last-writer-wins properties.
- **Predictable semantics**: Filesystem operations map to deterministic CRDT operations; no hidden merge logic.
- **Composable mounts**: Multiple spaces, repositories, or external stores can mount into the same namespace with explicit boundaries.
- **Cross-platform runtime**: Clients access the VFS through adapters for Node, Web, Native modules, and WASI.
- **Security-aware**: Permissions propagate via mount metadata, supporting per-directory ACLs and capability tokens.

## System Architecture

### 1. Structural Layer (RepTree)
- **Vertex Types**:
  - `RootMount`: entry points representing projects, spaces, or external providers.
  - `Directory`: folders containing children.
  - `File`: metadata node pointing to content references (text, binary, CRDT doc).
  - `Symlink / Shortcut`: references to other vertices, supporting virtual mounts.
  - `Metadata`: arbitrary key/value descriptors (tags, permissions, owners).
- **Properties**:
  - `name`, `slug`, `mtime`, `creator`, `sizeHint`, `casRef`, `docRef`, `contentType`, `visibility`, `acl`.
- **Operations**:
  - Move, rename, create/delete, link/unlink, atomic property updates, state-vector-based sync.

### 2. Content Layer (CAS + Adapters)
- **CAS**: Content-addressed blobs for binary payloads (media, archives).
- **Mutable Store**: Optional named pointers (`latest`, `draft`) mapping to CAS entries.
- **CRDT Documents**: Separate storage for collaborative text/binary CRDTs (e.g., Yjs, Rust-based). Files reference `docRef` instead of `casRef`.
- **Streaming Access**: chunked upload/download with resumable sessions.

### 3. Runtime Layer
- **FS Kernel**: A Node.js-like API that translates POSIX operations into RepTree mutations and content fetches:
  - `open/read/write/close`, `mkdir/rmdir`, `rename`, `symlink`, `stat`, `watch`.
  - Batch operations (transactions) for atomic multi-change commits.
- **Shell Adapter**: CLI tooling that exposes standard commands by calling the FS kernel; can run in terminals or remote agent contexts.
- **Web Adapter**: Service worker / WASM layer to mount VFS in browsers via File System Access API or custom UI.
- **Native Adapter**: FUSE-compatible bridge for desktop OS mounting (macOS, Linux) or mobile file providers.

### 4. Sync Engine
- **State Vectors**: Track applied operations per peer for incremental sync.
- **Operation Feed**: Append-only log per RepTree peer; bundling by path for efficient fetch.
- **Conflict Rules**:
  - Directory hierarchies resolve via move-tree semantics (no loops, no duplication).
  - Property conflicts use LWW timestamps with peer bias configuration (e.g., manual overrides).
- **Background Fetching**: Async loading of referenced CAS content with caching and eviction policies.

### 5. Observability Layer
- **Event Stream**: Emits structured events (`FILE_CREATED`, `MOUNT_ATTACHED`, `DOC_UPDATED`) for app integrations.
- **Indexing**: Optional pluggable search indexing (full-text, metadata) fed via CRDT updates.
- **Audit Trail**: Operation history per vertex for time-travel and undo/redo semantics.

## API Surface (Conceptual)

- **Filesystem API**:
  ```ts
  const vfs = await CollaborativeFS.mount({ peerId, mounts: [...] });
  await vfs.mkdir('/spaces/wiki/pages');
  await vfs.writeFile('/spaces/wiki/pages/home.md', '# Welcome', { adapter: 'crdt' });
  const entries = await vfs.readdir('/spaces/wiki');
  await vfs.applyPatch('/spaces/wiki/pages/home.md', patchText);
  ```
- **Shell Commands**:
  - `vfs mount <spaceId> /spaces/wiki`
  - `ls`, `cat`, `grep -R TODO /spaces/wiki`
  - `apply-patch /spaces/wiki/pages/home.md < patch.diff`
- **Event Hooks**:
  ```ts
  vfs.on('change', ({ path, type }) => { /* agent reaction */ });
  ```
- **Mount Configuration**:
  - `type`: `reptree`, `s3`, `git`, `http`.
  - `permissions`: read/write/execute flags, ACL list, capability token.
  - `visibility`: public/private/space-scoped.

## Data Flow Examples

### Creating a New Document
1. Client calls `vfs.writeFile('/notes/daily.md', initialText, { adapter: 'crdt' })`.
2. Kernel creates `File` vertex with `docRef` referencing a newly created CRDT doc.
3. RepTree logs operations (`CREATE`, `SET_PROPERTY`) and updates state vector.
4. CRDT adapter appends ops to document store; optional checkpoint generated.
5. Other peers sync: apply RepTree ops, fetch CRDT doc ops, display updated file.

### Uploading a Binary
1. Client streams chunks to CAS, receiving `contentAddress`.
2. Kernel sets `casRef` on the corresponding `File` vertex with metadata (`size`, `sha256`, `mime`).
3. Readers fetch CAS content on demand; offline clients cache locally.

### Mounting External Data
1. Administrator creates `RootMount` vertex pointing to external provider.
2. Adapter lazily materializes directory listings into RepTree vertices with metadata only.
3. Access operations proxy reads/writes to provider via adapter; optional caching to CAS.

## Cross-Platform Considerations
- **Node / Deno / Bun**: Provide ESM/CJS API with minimal dependencies, using storage adapters (IndexedDB, LevelDB, SQLite, in-memory).
- **Web**: WASM-compiled runtime; offline storage via IndexedDB + ServiceWorker for background sync.
- **Desktop**: Electron/Tauri wrappers plus native FUSE drivers for OS-level mounting.
- **Mobile**: React Native/Capacitor modules bridging to platform file APIs, with selective sync to conserve storage.
- **Serverless**: Adapter that mounts ephemeral in-memory RepTree with remote CAS (S3, R2).

## Interoperability & Integrations
- **Agent Tooling**: Reuse existing ApplyPatch/List/Grep commands by pointing to VFS paths.
- **CI/CD**: Pipelines can mount VFS snapshots to read/write build artifacts collaboratively.
- **Design/Media Tools**: Store project files as CAS references; share via mount points.
- **Knowledge Bases**: Render Markdown/MDX using CRDT-backed docs accessible via filesystem paths.
- **Automation Hooks**: Trigger functions or workflows on filesystem events (`*.md` save -> rebuild docs).

## Migration Strategy
- **Incremental Adoption**:
  1. Start with directory + metadata replication using RepTree, referencing existing CAS.
  2. Introduce CRDT-backed documents for selected file types (Markdown, JSON, config).
  3. Expand adapters to mount legacy storage systems.
- **Backwards Compatibility**:
  - Provide import/export tooling between flat files and VFS.
  - Preserve original storage URIs in metadata for traceability.
- **Versioning**:
  - Snapshot RepTree states per release tag.
  - Support `vfs checkout <stateVector>` for read-only historical views.

## Security & Permissions
- **ACL Propagation**: Store permission sets on vertices; enforce during operations.
- **Capability Tokens**: Issue scoped tokens for agents, specifying allowed paths and operations.
- **Audit Logging**: Append signed operation records for compliance.
- **Encryption**: Optionally encrypt CAS payloads per mount using symmetric keys managed via metadata.

## Performance & Scaling
- **Chunked sync**: Transfer operations in batches keyed by mount or directory to reduce conflict windows.
- **Lazy hydration**: Fetch child lists and content references on demand with caching.
- **Compaction**: Periodically consolidate CRDT doc ops with checkpoints; prune tombstoned vertices.
- **Index Services**: Optional background worker builds search indexes for content and metadata.

## Implementation Phases
1. **Prototype**: Minimal Node runtime with RepTree directory structure, CAS references, and shell CLI.
2. **Document Adapter**: Add CRDT-backed file type with applyPatch integration; expose event hooks.
3. **Cross-Platform Adapters**: Ship Web WASM + Electron/Tauri bindings; experimental FUSE driver.
4. **Permissions & Mounts**: Implement ACL metadata, capability tokens, and external mount adapters.
5. **Ecosystem Integration**: Publish SDKs, sample apps, and reference agents; create developer documentation.

## Open Questions
- How do we model symlinks and prevent cyclical traversal across mounts?
- Should we allow per-file CRDT engine selection (e.g., text vs. spatial docs)?
- What is the durability strategy for CAS in offline-first mobile environments?
- How do we enforce quota and eviction policies for large binary blobs?
- Can we offer transactional semantics across multiple files without sacrificing CRDT guarantees?
- How do we surface merge conflicts or LWW overwrites to users for manual resolution?
 
## Success Criteria
- Teams can embed the VFS to share collaborative folders/files across their apps with minimal integration effort.
- Agents and humans operate on the same filesystem abstraction using standard tools.
- Collaborative documents remain consistent across peers even with concurrent edits and offline work.
- External storage providers integrate via mounts while maintaining security boundaries.
- The system delivers acceptable performance on constrained devices and scales to large workspaces.
