Title: RepTree Commit Model — Optimistic Batches, Transient Writes, and Rollback

Status: Draft
Owner: RepTree
Last updated: 2025-09-24

Scope
This document specifies a client-side commit model for RepTree. It aligns with RepTree’s CRDT-based design in TypeScript: optimistic local application of operations, eventual consistency via state vectors, and best-effort rollback using inverses. It is not a cross-service server transaction protocol.

How RepTree works (today)
- Local-first ops: `moveVertex`, `setVertexProperty`, `setTransientVertexProperty` increment a Lamport clock, append to `localOps`, and apply immediately to in-memory state (optimistic UI).
- CRDTs: Move-Tree CRDT for structure and LWW/Yjs for properties. Conflicts converge deterministically (undo/do/redo strategy for moves; last-writer-wins for primitive properties; Yjs for rich docs).
- Sync: Peers exchange operations using a range-based State Vector; `getMissingOps(theirStateVector)` returns only what the other side lacks. No global locks or 2PC.
- Deletes: Implemented as moving a vertex under a null vertex `0`.

Commit concept (client-side)
A commit is a logical batch of local RepTree operations applied optimistically. A commit:
- Captures inverses for its own changes to enable local rollback if an application-layer validator rejects the batch.
- Emits its generated ops (via `popLocalOps`) to a transport (P2P, gateway, etc.).
- Treats a positive application-layer decision as success (optional ACK). On rejection (NACK or error), it applies the captured inverses in reverse order.

Why not 2PC
- RepTree already guarantees convergence with CRDTs. Atomic cross-service orchestration is outside RepTree’s scope.
- If an authoritative gateway exists, it may ACK/NACK batches. RepTree stays local-first; ACK/NACK is an integration concern, not a core requirement.

Inverses (best-effort rollback)
- setVertexProperty(key, value): inverse is setting the previous value (including `undefined` to remove). Capture the prior value at first touch within a commit.
- setTransientVertexProperty: inverse is restoring the prior transient value (or clearing). Transients are local-only and are superseded by durable LWW writes.
- moveVertex(id, parentId): inverse is moving back to the previous parent (capture before first move in the commit).
- newVertex(parent): inverse is delete (move to null vertex `0`).
- deleteVertex(id): inverse is restore (move back to captured previous parent).
- Yjs properties: the safest inverse is capturing a snapshot (or update diff) before first modification in the commit and applying it on rollback. When snapshots are not captured, prefer using transients or avoiding mid-commit Yjs mutations.

Sync and visibility
- Local state updates immediately. Peers obtain changes via state-vector-based op exchange.
- If using a validator/gateway, only surface “committed” status in UI after ACK. On NACK, run rollback and show an error.

Proposed minimal API (client wrapper)
```typescript
export type CommitAck = { ok: true } | { ok: false; reason?: string };

export class RepTreeCommit {
  private inverses: Array<() => void> = [];
  private touchedProps = new Map<string, unknown>(); // key@vertexId -> prior
  private touchedParents = new Map<string, string | null>(); // vertexId -> priorParent

  constructor(private tree: RepTree) {}

  run(work: () => void) {
    // Caller executes a batch of RepTree calls inside this function.
    work();
  }

  captureSet(vertexId: string, key: string, prior: unknown) {
    const k = `${key}@${vertexId}`;
    if (!this.touchedProps.has(k)) {
      this.touchedProps.set(k, prior);
      this.inverses.push(() => this.tree.setVertexProperty(vertexId, key, prior as any));
    }
  }

  captureMove(vertexId: string, priorParent: string | null) {
    if (!this.touchedParents.has(vertexId)) {
      this.touchedParents.set(vertexId, priorParent);
      if (priorParent !== undefined) {
        this.inverses.push(() => this.tree.moveVertex(vertexId, priorParent as any));
      }
    }
  }

  captureCreate(vertexId: string) {
    // Creation is move-from-null; inverse is delete
    this.inverses.push(() => this.tree.deleteVertex(vertexId));
  }

  rollback() {
    for (let i = this.inverses.length - 1; i >= 0; i--) this.inverses[i]();
    this.inverses = [];
  }
}
```

Integration sketch
- Begin: Create a commit wrapper and register lightweight hooks to capture prior values/parents around your writes.
- Execute: Call RepTree methods (optimistic update). After the batch, send `tree.popLocalOps()` to your transport.
- Decide: If your validator/gateway ACKs, you’re done. If it NACKs or times out fatally, call `commit.rollback()`.

Notes and caveats
- Rollback is best-effort and CRDT-safe. Inverses create new ops that converge; they do not “erase history.”
- Concurrent edits from other peers may interleave; final state is the CRDT merge of all ops including inverses.
- For Yjs, explicit snapshotting is recommended for reliable rollback.
- Transient properties are ideal for previews: write transients first, then promote to durable LWW values upon ACK.

Out of scope
- Cross-service distributed transactions or 2PC.
- Server-side orchestration semantics beyond an optional ACK/NACK integration.

Open questions
- Provide first-class commit helpers in the library (hooks to auto-capture inverses for moves/properties)?
- Lightweight ACK/NACK sample transport for demos and tests?
- Recommended patterns for Yjs snapshot capture and restore within commits?