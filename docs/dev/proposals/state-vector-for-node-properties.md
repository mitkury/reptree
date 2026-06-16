# Property Sync with Compacted State Vectors

## Status

Implemented.

## Summary

Property operations are LWW per `(nodeId, key)`, so sync only needs the latest winning op per key.

For properties, the state vector is not a full "seen property history" vector. It is an availability summary for retained compacted property ops. This lets peers compress property history while still using compact range-based state vectors.

## Goals
- Continue using range-based state vectors for property ops (same as move ops).
- Ensure sync always sends only **compacted property ops** (latest per key).
- Avoid sending ops that will be discarded due to LWW semantics.
- Let a compressed peer advertise retained property dots without forcing full-history peers to send evicted property writes.
- Keep move stream unchanged.

## Current State
- Properties are LWW, tracked in `propertyOpsByKey` (stores only latest op per key).
- Property state vector tracks ranges of retained compacted property ops per peer.
- `getMissingOps()` filters property ops by missing ranges, but sends from `propertyOpsByKey` which already contains only latest ops.

## Design

Continue using range-based state vectors for properties:

```ts
type StateVectors = {
  move: Record<string, number[][]>;
  prop: Record<string, number[][]>;
};
```

The property state vector tracks which retained property op ranges are available:

```json
{
  "move": {
    "peer1": [[1, 15], [18, 25]],
    "peer2": [[1, 8]]
  },
  "prop": {
    "peer1": [[1, 1000]],
    "peer2": [[1, 500]]
  }
}
```

The sync protocol is:

1. Peer A calls `getStateVectors()` and sends the result to Peer B.
2. Peer B calls `getMissingOps(peerAStateVectors)` and sends ops to Peer A.
3. Peer A calls `merge(opsFromPeerB)`

The sync signal is compact and scales with peers, not nodes.

### Compressed Property Peers

A peer may compress property history by keeping only the current LWW register for each `(nodeId, key)`.

Example:

```text
op 1: root.name = "first"
op 2: root.kind = "folder"
op 3: root.name = "second"
```

After compaction, retained property ops are `2` and `3`. Op `1` is known or obsolete, but it is not retained and should not be requested again.

The compressed peer can advertise:

```json
{
  "prop": {
    "remote-prop": [[2, 3]]
  }
}
```

A peer that still has historical property ops must not respond by sending op `1`. It should send only retained property ops that are missing from the receiver's compacted vector.

This is why `getMissingOps()` must filter from `getPropertyOps()` instead of from a full property history log.

## Ensuring Compacted Ops Are Sent

`getMissingOps()` sends properties from the retained property register set:

```ts
getMissingOps(theirStateVectors: StateVectors): NodeOperation[] {
  const missingPropRanges = this.propStateVector.diff(otherPropStateVector);
  const missingPropOps = this.filterOpsByRanges(
    this.getPropertyOps(),
    missingPropRanges
  );

  return [...missingMoveOps, ...missingPropOps];
}

private getPropertyOps(): SetNodeProperty[] {
  return Array.from(this.propertyOpsByKey.values());
}
```

How it works:

1. `propertyOpsByKey` stores only the latest op per `(nodeId, key)`.
2. `getPropertyOps()` returns only these compacted ops.
3. `filterOpsByRanges()` filters to ops that fall in missing ranges.
4. The result contains only compacted ops that the receiver needs.

## Receiver Application

When receiver applies property ops, LWW semantics handle duplicates:

```ts
private applyLLWProperty(op: SetNodeProperty, targetNode: NodeState) {
  const previousOp = this.propertyOpsByKey.get(this.getPropertyKey(op));

  if (!previousOp || isOpIdGreaterThan(op.id, previousOp.id)) {
    this.setLLWPropertyAndItsOpId(op, previousOp);
  } else {
    this.markOpSeen(op);
  }
}
```

If sender sends an op the receiver already has a newer version of, it's safely discarded.

## Advantages

- Compact sync signal. Only peer IDs and ranges.
- Sends compacted ops. `propertyOpsByKey` ensures only latest per key.
- Handles edge cases. Receiver LWW logic safely discards redundant ops.
- No protocol changes. Uses the existing state vector mechanism.
- Scales well. Sync signal size is independent of node and property count.

## Size Comparison

Sync signal:

```json
{
  "prop": {
    "peer1": [[1, 1000000]],
    "peer2": [[1, 500000]]
  }
}
```

This is small because it only contains peer IDs and number ranges.

Sent ops are only property ops that:

1. Fall in missing ranges from state-vector comparison.
2. Are latest per key from `propertyOpsByKey` compaction.

If receiver already has a newer version, receiver discards the older op by LWW.

## Potential Inefficiency

We might send a few ops that the receiver already has a newer version of. This is acceptable because the sync signal remains compact and the receiver discards redundant ops.

Example:

- Sender has: `node1:name = op1000`
- Receiver has: `node1:name = op1001` (newer)
- State vector says receiver missing range [800, 1000]
- Sender sends op1000
- Receiver applies, sees op1001 is newer, discards op1000

## Implementation Status

The current implementation already follows this approach:

- `propertyOpsByKey` stores only latest per key.
- `getPropertyOps()` returns only compacted ops.
- Property state vectors track retained compacted ranges per peer.
- `getMissingOps()` filters compacted ops by missing ranges.
- Compressed peers that advertise retained property dots do not receive evicted property history.

This proposal documents and validates the current approach.

## Recommendation

Continue using state vectors for property ops. The current implementation correctly:
1. Maintains LWW compaction in `propertyOpsByKey`
2. Sends only compacted ops during sync
3. Keeps sync signal compact (scales with peers, not nodes)

The minor inefficiency of potentially sending a few redundant ops is acceptable given the massive advantage of a compact sync signal that doesn't scale with node count.
