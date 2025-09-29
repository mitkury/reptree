Title: Shadow-Tree Transactions — Fork, Work, and Commit via Diff

Status: Proposal
Owner: RepTree
Last updated: 2025-09-26

Overview
Introduce an alternative transaction model that operates on a temporary fork ("shadow tree"). Entering `transact` creates a fresh `RepTree` instance initialized from the base tree. All vertex objects used inside the scope are bound to the shadow tree. On commit, we merge only the new operations from the shadow back into the base using RepTree’s existing operation logs and conflict-resolution. On cancel, the shadow is discarded.

Goals
- Isolation: Make transactional changes without mutating the base tree until commit.
- Deterministic commit: Reuse existing CRDT ops and ordering to merge changes.
- Ergonomics: Ensure vertex methods inside the transaction operate against the shadow without accidental cross-tree usage.

Non-goals
- Cross-peer atomicity. Commit is local to the base tree instance.
- Global distributed transactions or server 2PC.

High-level design
1) Fork: `beginShadowTransact(baseTree)` creates `shadowTree = baseTree.replicate(peerIdOrTmp)`. Save `shadowStartIndex` (shadow local-op start marker = 0 for a replicate).
2) Scope: Provide a transactional scope where any vertex access resolves to the shadow tree. Enforce tree affinity (see below).
3) Commit:
   - Extract diff ops from shadow: `newOps = shadowTree.popLocalOps()` (or slice tracked since start).
   - Apply to base using one of the options below.
4) Cancel: Drop shadow. Base remains unchanged.

Tree affinity enforcement
- Vertex objects already hold a reference to their `tree`. Inside a shadow transaction, any API that accepts `Vertex` should verify `vertex.tree === shadowTree` (or be tolerant via ID-only access and resolve in the current tree).
- Provide helpful errors: "Vertex belongs to a different tree (expected shadow)." and suggest using IDs.
- Utility: `assertSameTree(expectedTree, vertex)` and internal guard in high-traffic write methods.

Commit options
- Option A: Merge-as-foreign-peer (simple)
  - Create the shadow with a distinct peer id (e.g., `${base.peerId}#txn-${n}`).
  - On commit: `base.merge(newOps)`.
  - Pros: No reminting of op ids, easy, leverages existing merge.
  - Cons: Base `localOps` remains unchanged (commit ops appear as remote). Apps that depend on `base.popLocalOps()` to transmit new ops will miss these unless they also transmit `newOps` directly from the transaction path. State-vector now includes an extra peer per transaction (harmless but noisier).

- Option B: Rebase-as-base-peer (cleaner emission)
  - Remint `newOps` to the base peer id and renumber lamport counters to be strictly greater than base’s current counter.
  - Apply to base via internal apply (or public setters) while appending to `base.localOps`.
  - Pros: Apps continue to use `base.popLocalOps()`; no extra peer ids; state-vector unchanged in shape.
  - Cons: Requires op id remapping, careful lamport monotonicity, and avoiding re-triggering observers incorrectly.

Recommended path
- Start with Option A (simple merge), document that the caller must transmit `newOps` from the transaction commit path, not from `base.popLocalOps()`.
- Consider Option B later for tighter integration with existing emission flows.

API sketch (conceptual)
```ts
type ShadowTxn<T> = {
  tree: RepTree;           // shadow
  commit(): { ops: VertexOperation[] };
  cancel(): void;
}

function beginShadowTransact(base: RepTree, options?: { peerIdSuffix?: string }): ShadowTxn<void>;

// Usage
const txn = beginShadowTransact(base);
try {
  const shadowRoot = txn.tree.root!;
  const docs = shadowRoot.newNamedChild('Docs');
  const readme = docs.newNamedChild('README.md');
  readme.setProperty('type', 'file');

  const { ops } = txn.commit();        // Option A: return ops to send + merge into base
  base.merge(ops);                      // or library can do this internally
  transport.send(ops);                  // caller sends ops to peers
} catch {
  txn.cancel();
}
```

Yjs implications
- Forking via `replicate` reconstructs Yjs properties from ops; shadow has independent `Y.Doc` instances.
- All Yjs edits in shadow generate ops logged in `shadowTree.localOps`.
- Commit Option A: merge those ops as foreign peer. Fine for CRDT convergence.
- Commit Option B: requires remapping Yjs ops to base peer id and ensuring lamport order; ensure we do not emit duplicate Yjs updates to observers.
- Performance: Large Yjs docs may increase fork cost. Consider lazy reconstruction or property-level on-demand cloning if needed.

Concurrency
- While the shadow exists, the base may change. At commit, `merge(newOps)` integrates against the evolved base, with CRDT conflict resolution applied as usual.
- If the shadow assumed invariants that no longer hold (e.g., moved parents), the CRDT result may differ from what the user previewed. UIs should be prepared to re-render on commit.

Networking implications
- Option A: Application must send `ops` returned by commit. `base.popLocalOps()` won’t include them.
- Option B: Commit appends ops to `base.localOps` so existing sync path works. Requires op-id remapping.

Performance & memory
- Forking creates a new `RepTree` instance and applies all base ops. Cost is proportional to op count.
- For very large datasets, consider:
  - Using state-vector-based minimal bootstrapping (future work), or
  - Limiting transaction scope to subtrees via filtered replicate.

Observability
- Tag commit ops with a transaction id in metadata (if available) to aid debugging.
- Surface metrics: fork time, commit time, ops count, conflicts encountered.

Edge cases
- Vertex references from base used inside shadow scope: enforce tree affinity error or auto-resolve by id on access.
- Deleted vertices: operations against vertices removed from base while shadow is open will resolve via CRDT rules at commit.
- Nested shadow transactions: either disallow or stack multiple forks (costly). Recommended: single shadow at a time per base.

Test plan
- Fork/cancel leaves base unchanged.
- Fork/commit applies only shadow ops; base remains valid and accepts subsequent ops; convergence versus a baseline applying the same ops directly.
- Concurrent base mutations during shadow; commit still converges.
- Yjs edits in shadow: content matches expectations after commit; no duplicate observer churn.

Risks
- Option A requires apps to adapt emission flow for commit ops.
- Option B adds complexity around op id remapping and lamport monotonicity.
- Fork cost for very large trees; may require sub-tree or incremental fork strategies.

