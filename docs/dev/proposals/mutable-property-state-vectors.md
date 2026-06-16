# Mutable Property State Vectors

## Status

Accepted and folded into `bulk-apply-state-vectors.md`.

## Summary

This proposal originally argued for adding point deletion to `StateVector` so RepTree could remove an evicted property op from `propStateVector` instead of rebuilding the whole vector.

That design is now the canonical property state-vector design:

- `knownOps` tracks accepted or discarded ops for duplicate suppression.
- `propStateVector` tracks retained compacted property ops this replica can send.
- `propertyOpsByKey` keeps only the latest winning op per `(nodeId, key)`.
- `propStateVector` is maintained incrementally with `updateFromOp()` and `removeFromOp()`.

The invariant is:

```ts
propStateVector == StateVector.fromOperations(getPropertyOps())
```

## Important Detail

A latest-counter vector per peer is not enough for compacted properties.

Example:

```text
op 1: nodeA.color = red
op 2: nodeB.name = desk
op 3: nodeA.color = blue
```

After compaction, retained property ops are `2` and `3`. Op `1` is known but not retained and cannot be sent.

So the property vector must represent retained sendable ops, including holes created by compaction:

```text
propStateVector = [[2, 3]]
```

`knownOps` can remember that op `1` was seen. The state vector should not.

## Move Ops

Do not use point deletion for move ops in normal RepTree behavior. Move history is retained once it is sendable, so move vectors remain monotonic for `moveOps`.

Pending missing-parent moves are known for duplicate suppression, but they are not in `moveOps` yet and cannot be returned by `getMissingOps()`. They must not be added to `moveStateVector` until the parent exists and the move enters `moveOps`.
