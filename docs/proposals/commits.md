Title: RepTree Transactions — Optimistic Scope with Best-Effort Rollback

Status: Draft
Owner: RepTree
Last updated: 2025-09-24

Summary
RepTree now provides a simple transactional API: `tree.transact(() => { ... })`. All operations executed within the scope apply optimistically to the in-memory state. If the function throws, RepTree performs a best-effort rollback by reverting changes directly on internal state and truncating any local ops generated during the transaction. On success, the generated ops remain and can be synced.

API
```ts
interface RepTree {
  transact(work: () => void): void;
}
```

Semantics
- Scope: Any `moveVertex`, `setVertexProperty`, `setTransientVertexProperty`, and vertex creation done inside `transact` is part of the transaction.
- Optimistic apply: Changes are applied immediately to UI state.
- Rollback on exception: If `work()` throws, RepTree:
  - Applies captured inverses in reverse order directly to internal state (no new ops emitted during rollback).
  - Truncates `localOps` to drop ops generated during the failed transaction.
  - Truncates internal op logs (`moveOps`, `setPropertyOps`) to the pre-transaction indices so `getAllOps()` doesn’t include the failed ops.
- Success path: If `work()` completes normally, the transaction frame is discarded and the generated ops remain.

Coverage of inverses
- setVertexProperty(k, v): Captures the prior value at first touch; rollback restores that value (including `undefined` removal).
- setTransientVertexProperty(k, v): Captures prior transient value; rollback restores it.
- moveVertex(id, parentId): Captures prior parent at first touch; rollback moves the vertex back by mutating internal state directly.
- newVertex(parentId): Captures creation; rollback performs a local delete by moving under the null vertex `0` without emitting ops.

Limitations
- Yjs properties: v1 does not snapshot or reverse Yjs document deltas inside transactions. Prefer transients for preview or implement snapshot/restore as a follow-up.
- Distributed semantics: Transactions are local-only ergonomics for UI and do not provide cross-peer atomicity. After success, ops synchronize via state vectors as usual.

Usage
```ts
vertex.tree.transact(() => {
  const a = vertex.newChild();
  const b = a.newChild();
  const c = b.newChild();
  c.setProperty("hello", "world");

  // Throw to cancel
  throw new Error("Sorry, changed my mind");
});
```

Behavioral guarantees
- No partial op leakage: On rollback, `popLocalOps()` called later will not include the aborted ops.
- UI consistency: Internal state is restored to pre-transaction values for touched entities.
- CRDT convergence: Rollback is applied via direct state mutation rather than compensating ops, so history does not contain the aborted operations.

Future work
- Optional Yjs snapshot/restore within `transact` for rich doc fields.
- Optional nested transactions (currently supported via a stack; outer rollback restores the full outer scope).
- Optional return value and typed result helpers.