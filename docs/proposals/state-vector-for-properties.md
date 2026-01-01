# Proposal: Property Sync Without State Vectors

## Summary
Property operations are LWW per `(vertexId, key)`, so we don’t need the full history to sync. Instead of a range-based state vector for property ops, this proposal introduces a **key-scoped digest** that tracks only the latest op per key and uses a two-step exchange to request the missing winners. This keeps property sync compact and avoids advertising gaps that no longer matter after compaction.

## Goals
- Replace property stream state vectors with a **latest-per-key digest**.
- Reduce sync payloads by exchanging only the **current winners**.
- Preserve LWW determinism using `(counter, peerId)` ordering.
- Keep move stream unchanged.

## Non-goals
- Changing move CRDT semantics.
- Adding server-side compaction (can be a follow-up).
- Optimizing for privacy (digest still reveals keys).

## Current State (High-Level)
- Properties are LWW, but we still track property ops via a stream-local state vector.
- The state vector records ranges of property ops that may no longer matter once LWW compaction is applied.

## Proposed Design

### 1. Property Digest (Latest-Per-Key)
Maintain a per-tree property digest:

```ts
// key = `${vertexId}:${propertyKey}`
// value = OpId of the latest LWW op
Record<string, OpId>
```

This is derived from (or identical to) the latest-per-key property op map already stored in-memory.

### 2. Peer Heads (Optional)
Maintain optional peer heads for property ops:

```ts
Record<peerId, number> // max counter seen per peer in property stream
```

This doesn’t track ranges; it only captures per-peer maximum counters to enable cheap “likely up-to-date” checks and can help short-circuit some comparisons when a peer’s head is behind.

### 3. Sync Protocol (Two-Step)

#### Step A: Exchange digests
Peers exchange their property digest (optionally paginated or hashed).

- Sender: `digest = { key -> opId }`
- Receiver: compares against local latest for each key.

#### Step B: Request missing winners
Receiver requests only the keys where:
- It has no entry for the key, or
- Its opId is older than the sender’s opId by LWW comparison.

Sender responds with only the **current winning ops** for those keys.

### 4. Ordering and Application
- Apply missing move ops first (as today).
- Apply property winners next; LWW comparison is done on the opId, not on order received.

## API Sketch

```ts
// Property digest
getPropertyDigest(): Record<string, OpId>;

// Request / response
getPropertyOpsForKeys(keys: string[]): SetVertexProperty[];
```

## Advantages
- **No range tracking** for property history that no longer matters.
- **Smaller sync payloads** for property-heavy trees.
- **Deterministic LWW** based solely on latest op per key.
- **Simpler semantics** for properties: “send me the winner for these keys.”

## Trade-offs
- **Digest size** is proportional to number of properties (not number of ops).
- Requires a **two-step handshake** to avoid sending all winners unconditionally.
- Digest still exposes key names unless hashed or scoped.

## Migration Strategy
- The digest can be built directly from existing property compaction state.
- Existing state vector payloads can be supported during transition by treating them as “legacy” and preferring digest-based sync when available.

## Open Questions
- Should digests be chunked by vertex or by key prefix for very large trees?
- Do we want a compact hash-based summary (e.g., Merkle tree) for very large property sets?
- Should property delete be represented as a tombstone in the digest or as `value: undefined`?

## Recommendation
Adopt the digest-based property sync as the default for the property stream, while keeping move ops and their state vector unchanged. This aligns with LWW semantics and avoids tracking unnecessary property history.
