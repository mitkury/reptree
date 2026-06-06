# Proposal: Bulk Apply Should Rebuild State Vectors Once

## Summary

RepTree should treat constructor replication and `merge(ops)` as bulk operation application. During bulk apply, RepTree should apply all operations first, then rebuild state vectors once at the end.

This keeps normal live edits incremental, but avoids rebuilding the property state vector thousands of times while loading a saved tree.

## Use Case

SIE stores editor spaces as RepTree operation logs. A large imported semantic layer currently has:

- 6,720 ops
- 601 materialized editor nodes
- about 1.5 MB of JSONL operation storage
- many property ops because each semantic object has transform, bounds, render, and metadata components

Opening that space used `new RepTree(peerId, ops)` in the editor and API.

The slow path was not JSON parsing, rendering, or tree traversal. It was RepTree replay:

- local benchmark with constructor path: roughly 4-8 seconds
- same ops with state vectors disabled during replay and rebuilt once: roughly 45-60 ms
- browser after workaround: heavy space load path around 80-100 ms, viewport sync around 8-10 ms

SIE worked around this by doing:

```ts
const tree = new RepTree(peerId, []);
tree.popLocalOps();
tree.stateVectorEnabled = false;
tree.merge(ops);
tree.stateVectorEnabled = true;
```

That should not be application code. It is a RepTree bulk-load behavior.

## Current Problem

RepTree stores compacted property ops in `propertyOpsByKey`, keyed by `(nodeId, key)`.

When a persistent property op wins LWW, `setLLWPropertyAndItsOpId` calls `refreshPropStateVector()`.

`refreshPropStateVector()` rebuilds the entire property state vector:

```ts
this.propStateVector = StateVector.fromOperations(this.getPropertyOps());
```

That is fine for single live edits. It is bad during bulk replay.

For a log with many property ops, this becomes repeated full rebuilds:

```text
apply property op 1 -> rebuild vector from all compacted property ops
apply property op 2 -> rebuild vector from all compacted property ops
apply property op 3 -> rebuild vector from all compacted property ops
...
```

The work scales like repeated `O(compactedPropertyOps)` rebuilds during import. Loading a saved tree should not have that cost.

## Desired Behavior

RepTree should support two modes:

1. Incremental apply for local edits and small live sync batches.
2. Bulk apply for constructor replication, saved-log loading, and large remote merges.

In bulk apply:

- move ops are applied as they are today
- property ops still use LWW and pending-node behavior
- known ops are still recorded
- op-applied callbacks still fire unless a future API explicitly suppresses them
- state vectors are not rebuilt after each property op
- state vectors are rebuilt once after all operations are applied

The final tree state and sync behavior should be identical to the current implementation.

## Proposed API

Keep the default API simple:

```ts
const tree = new RepTree(peerId, ops);
tree.merge(opsFromPeer);
```

These should automatically use bulk state-vector maintenance when applying more than one operation, or at least when applying more than a small threshold.

If explicit control is useful, add one public method:

```ts
tree.applyBulk(ops);
```

But the constructor path should still use the bulk behavior internally. Users should not need to know about state-vector internals to load a saved tree quickly.

## Implementation Direction

Add an internal helper:

```ts
private applyOpsBulk(ops: ReadonlyArray<NodeOperation>) {
  const wasEnabled = this._stateVectorEnabled;
  if (wasEnabled) {
    this._stateVectorEnabled = false;
  }

  try {
    this.applyOps(ops);
  } finally {
    if (wasEnabled) {
      this._stateVectorEnabled = true;
      this.moveStateVector = StateVector.fromOperations(this.moveOps);
      this.propStateVector = StateVector.fromOperations(this.getPropertyOps());
    }
  }
}
```

Then use it from:

- constructor when `ops.length > 0`
- `merge(ops)` when `ops.length > 1` or above a threshold
- any future import/snapshot restore path

This keeps the existing `stateVectorEnabled` public property, but application code no longer has to toggle it for normal bulk loading.

## Edge Cases

### Existing State Vector Disabled

If `stateVectorEnabled` is already false before bulk apply, leave it false and do not rebuild at the end.

### Exceptions During Apply

Use `try/finally` so the enabled flag is restored. If rebuilding after a partial failed apply is risky, the first version can restrict bulk apply to constructor and normal `merge` paths that already assume valid ops.

### Op-Applied Callbacks

Keep callback behavior unchanged in the first version. The optimization should only change when state vectors rebuild, not which events fire.

### Missing Parents and Pending Properties

Do not bypass current pending move/property logic. Bulk apply should still call the same move and property application methods. The change is only state-vector maintenance timing.

### Compacted Property Ops

Rebuilding `propStateVector` from `getPropertyOps()` preserves the current compacted property sync model documented in `state-vector-for-node-properties.md`.

## Tests

Add tests that compare current semantic behavior, not implementation details:

1. Constructor from ops produces the same structure and properties as incremental apply.
2. `merge(largeOps)` produces the same `getStateVectors()` as applying the same ops one by one.
3. LWW property compaction still works after bulk apply.
4. Duplicate ops remain ignored.
5. Pending properties before node creation still apply when the move op arrives.

Add one benchmark:

```text
load tree with hundreds of nodes and thousands of property ops
```

The benchmark should include constructor and `merge`.

## Recommendation

Make bulk state-vector maintenance part of RepTree itself.

The current public workaround is too leaky. If a user passes a saved operation log to the constructor or calls `merge` with a large batch, RepTree has enough context to know it is replaying a batch. It should avoid repeated state-vector rebuilds and produce the same final state with one rebuild at the end.

The smallest useful first step:

1. Add internal `applyOpsBulk`.
2. Use it in the constructor.
3. Add a regression benchmark for the SIE-shaped operation log.
4. If clean, route large `merge` batches through it too.
