# Property State Vectors Are Incremental

## Status

Implemented.

## Summary

RepTree should maintain `propStateVector` as an incremental cache of retained compacted property ops.

The property state vector does not track every property op ever seen. It tracks the property ops that remain sendable after LWW compaction by `(nodeId, key)`.

The invariant is:

```ts
propStateVector == StateVector.fromOperations(getPropertyOps())
```

RepTree should preserve that invariant without rebuilding the whole property vector during normal property application.

## Use Case

A saved object graph can contain hundreds of nodes and thousands of property ops.

Before this change, replaying that log was slow because RepTree rebuilt the entire property state vector after many winning property ops.

Application code worked around this by doing:

```ts
tree.stateVectorEnabled = false;
tree.merge(ops);
tree.stateVectorEnabled = true;
```

That should not be application code.

## Problem

`knownOps` and `propStateVector` are different things:

- `knownOps` tracks ops this replica has accepted or discarded, so duplicate processing can be skipped.
- `propStateVector` tracks retained compacted property ops this replica can send to another peer.

For a new `(nodeId, key)`, the winning property op can simply be added to the vector.

For a replacement on an existing `(nodeId, key)`, the previous retained op must be removed from the vector and the new op added.

Rebuilding from every retained property op is correct but too expensive for replacement-heavy edits.

## Behavior

Maintain the property state vector according to the compacted property op set:

- if a winning persistent property op is the first retained op for `(nodeId, key)`, call `propStateVector.updateFromOp(op)`
- if a winning persistent property op replaces an older retained op for `(nodeId, key)`, call `propStateVector.removeFromOp(previousOp)` and then `propStateVector.updateFromOp(op)`
- if a property op loses LWW, mark it seen but do not include it in `propStateVector`
- transient properties still do not affect `propStateVector`
- callbacks should observe coherent state vectors for the op being reported

The final tree state and sync behavior should remain identical to the compacted property sync model.

## API

No public RepTree API change.

Users should keep using:

```ts
const tree = new RepTree(peerId, ops);
tree.merge(opsFromPeer);
```

## Implementation

`StateVector` has point deletion:

```ts
remove(peerId: string, counter: number): boolean;
removeFromOp(op: NodeOperation): boolean;
```

RepTree passes the previous retained property op through LWW application:

```ts
const previousOp = this.propertyOpsByKey.get(`${op.key}@${op.targetId}`);

if (!previousOp || isOpIdGreaterThan(op.id, previousOp.id)) {
  this.setLLWPropertyAndItsOpId(op, previousOp);
} else {
  this.markOpSeen(op);
}
```

Record the vector update before firing `observeOpApplied` callbacks:

```ts
private setLLWPropertyAndItsOpId(op: SetNodeProperty, previousOp: SetNodeProperty | undefined) {
  this.propertyOpsByKey.set(`${op.key}@${op.targetId}`, op);
  this.state.setProperty(op.targetId, op.key, op.value);
  this.recordRetainedPropertyOpInStateVector(op, previousOp);
  this.reportPropertyOpAsApplied(op);
}

private recordRetainedPropertyOpInStateVector(
  op: SetNodeProperty,
  previousOp: SetNodeProperty | undefined,
) {
  if (!this._stateVectorEnabled) {
    return;
  }

  if (previousOp) {
    this.propStateVector.removeFromOp(previousOp);
  }
  this.propStateVector.updateFromOp(op);
}
```

## Move Vector Invariant

Move vectors should not advertise move ops that `getMissingOps()` cannot return.

A move with a missing parent is known for duplicate suppression, but it is not in `moveOps` yet. Until it is in `moveOps`, it should not be included in `moveStateVector`.

This keeps the sync contract simple:

```text
state vector range -> getMissingOps can return the advertised ops
```

## Edge Cases

### New Property Key

Only call `updateFromOp(op)`.

### Replacing a Retained Property Op

Remove the previous retained op ID, then add the new op ID.

### Losing Property Ops

Mark the op as seen for duplicate suppression, but do not add it to `propStateVector`.

### Missing Nodes and Pending Properties

Do not bypass current pending property logic. When a pending property finally applies, use the same retained-op update rule.

### Missing Parents and Move Ops

Do not include a pending missing-parent move in `moveStateVector` until the move is in `moveOps` and therefore sendable.

## Tests

Tests assert the sync contract:

1. Constructor replay with many new property keys does not call `StateVector.fromOperations`.
2. Constructor replay with a replacement property op also does not call `StateVector.fromOperations`.
3. Replacement property vectors send the retained op through `getMissingOps()`.
4. `observeOpApplied` callbacks see state vectors that already contain the reported move/property op.
5. A pending missing-parent move is not advertised until it is sendable.
6. `StateVector.remove()` deletes, shrinks, and splits ranges correctly.

Benchmarks cover both shapes:

```text
load tree with hundreds of nodes and thousands of property ops
load one node with one hot property and thousands of replacements
```

The benchmarks compare constructor loading, property-heavy `merge`, and the old application workaround.

## Recommendation

Keep property state-vector maintenance fully incremental.

The old public workaround was too leaky, and a special bulk mode is more machinery than this needs. The direct fix is to keep the state vector equal to the retained property op set with update and point deletion.
