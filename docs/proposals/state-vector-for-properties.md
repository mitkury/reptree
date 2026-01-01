# Proposal: Property Sync Without State Vectors

## Summary
Property operations are LWW per `(vertexId, key)`, so we don't need the full history to sync. Instead of a range-based state vector for property ops, this proposal uses a **vertex-grouped digest** that tracks only the latest op per key. The digest is integrated into the existing sync protocol, allowing peers to compute and send only missing property ops.

## Goals
- Replace property stream state vectors with a **vertex-grouped digest** (`Record<vertexId, Record<propertyKey, OpId>>`).
- Reduce sync payloads by sending only **missing property ops**.
- Preserve LWW determinism using `(counter, peerId)` ordering.
- Keep move stream unchanged (still uses range-based state vector).

## Current State
- Properties are LWW, but we still track property ops via a stream-local state vector.
- The state vector records ranges of property ops that no longer matter once LWW compaction is applied.
- Sync protocol: peers exchange state vectors, then each peer calls `getMissingOps()` to compute what to send.

## Proposed Design

### Property Digest Structure
Replace the property state vector with a vertex-grouped digest:

```ts
type PropertyDigest = Record<vertexId, Record<propertyKey, OpId>>
```

This is derived from `propertyOpsByKey` which stores `Map<PropertyKeyAtVertexId, SetVertexProperty>` where `PropertyKeyAtVertexId = ${key}@${vertexId}`.

### Integrated Sync Protocol

The existing sync protocol remains one round-trip:
1. Peer A calls `getStateVectors()` → sends to Peer B
2. Peer B calls `getMissingOps(peerAStateVectors)` → computes and sends ops to Peer A
3. Peer A calls `merge(opsFromPeerB)`

We change what's in the state vectors:
- **Move ops**: Keep range-based state vector (unchanged)
- **Property ops**: Replace with vertex-grouped digest

```ts
type StateVectors = {
  move: Record<string, number[][]>;  // Range-based (unchanged)
  prop: Record<string, Record<string, OpId>>;  // Vertex-grouped digest
};
```

### Digest Comparison Logic

When `getMissingOps()` is called, compare digests to find missing properties:

```ts
getMissingOps(theirStateVectors: StateVectors): VertexOperation[] {
  // Move ops: existing range-based logic
  const missingMoveOps = /* ... existing logic ... */;
  
  // Property ops: digest-based comparison
  const missingPropertyOps: SetVertexProperty[] = [];
  const theirPropDigest = theirStateVectors.prop;
  const ourPropOps = this.getPropertyOps(); // Already latest per key
  
  for (const op of ourPropOps) {
    const theirVertexProps = theirPropDigest[op.targetId];
    const theirOpId = theirVertexProps?.[op.key];
    
    // Include if they don't have this key, or our op is newer
    if (!theirOpId || isOpIdGreaterThan(op.id, theirOpId)) {
      missingPropertyOps.push(op);
    }
  }
  
  return [...missingMoveOps, ...missingPropertyOps];
}
```

## API Changes

```ts
// Updated getStateVectors() - prop is now a vertex-grouped digest
getStateVectors(): {
  move: Record<string, number[][]>;
  prop: Record<string, Record<string, OpId>>;
};

// getMissingOps() automatically handles digest comparison
getMissingOps(theirStateVectors: StateVectors): VertexOperation[];
```

No new public API methods needed - the digest is built from existing `propertyOpsByKey` data.

## Implementation

### Building the Digest
```ts
getStateVectors() {
  // ... existing move state vector ...
  
  // Build vertex-grouped digest from propertyOpsByKey
  const propDigest: Record<string, Record<string, OpId>> = {};
  for (const [keyAtVertex, op] of this.propertyOpsByKey) {
    // Parse key format: `${propertyKey}@${vertexId}`
    const [propertyKey, vertexId] = keyAtVertex.split('@');
    
    if (!propDigest[vertexId]) {
      propDigest[vertexId] = {};
    }
    propDigest[vertexId][propertyKey] = op.id;
  }
  
  return { move: ..., prop: propDigest };
}
```

### Example: Property Digest JSON

```json
{
  "move": {
    "peer1": [[1, 15], [18, 25]],
    "peer2": [[1, 8]]
  },
  "prop": {
    "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6": {
      "name": {"counter": 42, "peerId": "peer1"},
      "age": {"counter": 43, "peerId": "peer1"}
    },
    "b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7": {
      "type": {"counter": 12, "peerId": "peer2"},
      "createdAt": {"counter": 13, "peerId": "peer2"}
    }
  }
}
```

## Advantages
- **No range tracking** for property history that no longer matters.
- **Smaller sync payloads** - only missing property ops are sent.
- **Compact structure** - vertex IDs not repeated per property (~37% smaller than flat structure).
- **Deterministic LWW** based solely on latest op per key.
- **No protocol changes** - integrates into existing sync flow.
- **Enables partial sync** - can request properties for specific vertices.

## Size Comparison

**Move State Vector (Range-Based):**
- Very compact: `{"peer1": [[1, 1000]]}` = ~43 chars for 1000 ops
- Compresses sequential ops into ranges

**Property Digest (Vertex-Grouped):**
- ~60-87 chars per additional property on a vertex
- For 10k vertices × 5 properties = 50k properties: ~2.9-3.8 MB uncompressed
- With compression: ~1-1.5 MB
- Still much better than sending all ops: 50k ops × ~200 bytes = ~10 MB

The digest is less compact than move state vectors, but appropriate for LWW properties because we only care about latest ops (ranges don't help), and it still sends only missing ops.

## Migration Strategy
- The digest can be built directly from `propertyOpsByKey` - no new storage needed.
- For backward compatibility during transition:
  - `getStateVectors()` can return both formats (digest + legacy ranges)
  - `getMissingOps()` can handle both formats
  - Newer peers prefer digest, older peers fall back to ranges
- After migration period, remove range-based property state vector entirely.

## Handling Property Deletes
- Property deletes are represented as `SetVertexProperty` with `value: undefined`
- The digest includes the delete op's OpId if it's the latest op for that key
- Receiver will apply the delete if the OpId is newer than their current value
