Title: RepTree Transactions — Optimistic Scope with Best-Effort Rollback

Status: Draft
Owner: RepTree
Last updated: 2025-09-24

Summary
RepTree provides a transactional API: `tree.transact(() => { ... })`. Operations in the scope apply optimistically. If the scope throws, RepTree reverts touched state and drops any generated local ops; otherwise, it keeps the ops for synchronization.

API
```ts
interface RepTree {
  transact(work: () => void): void;
}
```

Semantics
- Scope: `moveVertex`, `setVertexProperty`, `setTransientVertexProperty`, and vertex creation within `transact` are included.
- Optimistic apply: Immediate UI updates.
- Rollback on exception:
  - Applies inverses in reverse order by mutating internal state (no new ops during rollback).
  - Truncates `localOps` and internal op logs (`moveOps`, `setPropertyOps`) to pre-transaction indices.
  - Rebuilds `knownOps` and state vector to reflect the truncated logs.
- Success: Keeps generated ops; no further action.

Coverage of inverses
- setVertexProperty(k, v): Capture prior value at first touch; restore on rollback (including `undefined`).
- setTransientVertexProperty(k, v): Capture prior transient; restore on rollback.
- moveVertex(id, parentId): Capture prior parent; restore by updating internal state.
- newVertex(parentId): Capture creation; rollback moves it under null vertex `0` (local-only) without emitting ops.

Usage
```ts
vertex.tree.transact(() => {
  const a = vertex.newChild();
  const b = a.newChild();
  const c = b.newChild();
  c.setProperty("hello", "world");

  // cancel
  throw new Error("Sorry, changed my mind");
});
```

Behavioral guarantees
- No partial op leakage into `popLocalOps()` after rollback.
- UI and internal state return to pre-transaction values for all touched items.
- Convergence preserved; aborted ops are not present in history.

Plan to support Yjs properties inside transactions
- Problem: Yjs edits are mutable CRDT updates applied directly to `Y.Doc`. The current implementation does not capture or reverse these deltas in `transact`.

- Goals:
  1) Ensure edits within a transaction are either fully applied on success or fully reverted on rollback.
  2) Avoid emitting intermediate Yjs ops during rollback.

- Approach A (Snapshot/Restore):
  - On first touch of a Yjs-backed property in a transaction, capture a baseline snapshot.
    - Use `Y.encodeStateAsUpdate(doc)` as a baseline blob.
  - On rollback, reconstruct the document by:
    - Creating a fresh `Y.Doc`, applying the baseline update, and replacing the property in internal state; or
    - Clearing/transplanting the current doc and re-applying the baseline.
  - On success, do nothing special; ops generated from Yjs updates remain.

- Approach B (Transactional Suppression + Aggregation):
  - During a transaction, buffer local Yjs updates instead of emitting ops immediately.
  - On success, aggregate buffered updates into one or few ops and apply them.
  - On rollback, discard the buffer and restore from baseline update.
  - Requires: a per-property buffer and a guard to skip op emission from Yjs observers while in a transaction.

- Recommended initial implementation (A):
  - Minimal invasive change; works without changing Yjs observer emission path.
  - Steps:
    1) On first write to Yjs property inside `transact`, store `baseline = Y.encodeStateAsUpdate(doc)` in the txn frame.
    2) Add a rollback inverse that replaces the property value with a newly constructed `Y.Doc` then applies `baseline`.
    3) Ensure replacement mutates internal state directly (no op emission).

- Follow-up (B) for efficiency:
  - Add buffer/aggregation to reduce op volume and improve atomicity semantics.

Testing Yjs support
- Unit tests:
  - Success path: edits persist; state equals post-transaction state; ops present.
  - Rollback path: edits discarded; property equal to baseline; no new ops remain.
  - Mixed ops: Yjs + moves + primitives within same transaction rollback correctly.

