# Proposal: Property Sync with Compacted State Vectors

## Summary
Property operations are LWW per `(vertexId, key)`, so we only need the latest op per key for sync. This proposal ensures that when syncing property ops using state vectors, we always send only the **compacted** (latest-per-key) operations, avoiding redundant ops that would be discarded due to LWW semantics.

## Goals
- Continue using range-based state vectors for property ops (same as move ops).
- Ensure sync always sends only **compacted property ops** (latest per key).
- Avoid sending ops that will be discarded due to LWW semantics.
- Keep move stream unchanged.

## Current State
- Properties are LWW, tracked in `propertyOpsByKey` (stores only latest op per key).
- Property state vector tracks ranges of property ops per peer.
- `getMissingOps()` filters property ops by missing ranges, but sends from `propertyOpsByKey` which already contains only latest ops.

## Proposed Design

### State Vector Structure (Unchanged)
Continue using range-based state vectors for properties:

```ts
type StateVectors = {
  move: Record<string, number[][]>;  // Range-based
  prop: Record<string, number[][]>;  // Range-based (unchanged)
};
```

The state vector tracks which property op ranges have been applied:
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

### Sync Protocol (Unchanged)
The existing sync protocol remains:
1. Peer A calls `getStateVectors()` → sends to Peer B (just peer IDs + ranges)
2. Peer B calls `getMissingOps(peerAStateVectors)` → computes and sends ops to Peer A
3. Peer A calls `merge(opsFromPeerB)`

**Key point:** The sync signal is compact (~100-1000 bytes, scales with peers, not vertices).

### Ensuring Compacted Ops Are Sent

The current implementation already does this correctly:

```ts
getMissingOps(theirStateVectors: StateVectors): VertexOperation[] {
  // Move ops: existing range-based logic
  const missingMoveOps = /* ... existing logic ... */;

  // Property ops: filter compacted ops by missing ranges
  const missingPropRanges = this.propStateVector.diff(otherPropStateVector);
  const missingPropOps = this.filterOpsByRanges(
    this.getPropertyOps(),  // Already returns only latest per key
    missingPropRanges
  );

  return [...missingMoveOps, ...missingPropOps];
}

private getPropertyOps(): SetVertexProperty[] {
  // Returns only latest op per key (already compacted)
  return Array.from(this.propertyOpsByKey.values());
}
```

**How it works:**
1. `propertyOpsByKey` stores only the latest op per `(vertexId, key)` (LWW compaction).
2. `getPropertyOps()` returns only these compacted ops.
3. `filterOpsByRanges()` filters to ops that fall in missing ranges.
4. Result: Only send compacted ops that receiver needs.

### Receiver Application

When receiver applies property ops, LWW semantics handle duplicates:

```ts
private applyLLWProperty(op: SetVertexProperty, targetVertex: VertexState) {
  const prevOpId = this.propertyOpsByKey.get(`${op.key}@${op.targetId}`)?.id;

  // Only apply if this op is newer (or first time)
  if (!prevOpId || isOpIdGreaterThan(op.id, prevOpId)) {
    this.setLLWPropertyAndItsOpId(op);
  } else {
    this.markOpSeen(op, false);  // Discard older op
  }
}
```

If sender sends an op the receiver already has a newer version of, it's safely discarded.

## Advantages
- **Compact sync signal** - Only peer IDs + ranges (~100-1000 bytes, scales with peers).
- **Already sends compacted ops** - `propertyOpsByKey` ensures only latest per key.
- **Handles edge cases** - Receiver's LWW logic safely discards redundant ops.
- **No protocol changes** - Uses existing state vector mechanism.
- **Scales well** - Sync signal size independent of vertex/property count.

## Size Comparison

**Sync Signal (State Vector):**
```json
{
  "prop": {
    "peer1": [[1, 1000000]],
    "peer2": [[1, 500000]]
  }
}
```
- Size: ~100-1000 bytes (only peer IDs + number ranges)
- Scales with: Number of peers (typically 10-100)
- Independent of: Number of vertices or properties

**What We Send (Ops):**
- Only property ops that:
  1. Fall in missing ranges (from state vector comparison)
  2. Are latest per key (from `propertyOpsByKey` compaction)
- If receiver already has newer version, it's discarded by LWW logic

## Potential Inefficiency

**Minor inefficiency:** We might send a few ops that the receiver already has a newer version of. However:
- The sync signal remains compact (scales with peers, not vertices).
- The receiver's LWW logic safely handles and discards redundant ops.
- The alternative (digest) would require sending vertex IDs for every property (~300MB for 1M vertices), which is far worse.

**Example:**
- Sender has: `vertex1:name = op1000`
- Receiver has: `vertex1:name = op1001` (newer)
- State vector says receiver missing range [800, 1000]
- Sender sends op1000
- Receiver applies, sees op1001 is newer, discards op1000

This is acceptable because the sync signal stays compact.

## Implementation Status

The current implementation already follows this approach:
- ✅ `propertyOpsByKey` stores only latest per key (compacted)
- ✅ `getPropertyOps()` returns only compacted ops
- ✅ State vectors track ranges per peer
- ✅ `getMissingOps()` filters compacted ops by missing ranges

**No changes needed** - this proposal documents and validates the current approach.

## Recommendation

Continue using state vectors for property ops. The current implementation correctly:
1. Maintains LWW compaction in `propertyOpsByKey`
2. Sends only compacted ops during sync
3. Keeps sync signal compact (scales with peers, not vertices)

The minor inefficiency of potentially sending a few redundant ops is acceptable given the massive advantage of a compact sync signal that doesn't scale with vertex count.
