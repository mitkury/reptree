# Proposal: Separate Operation Streams and Lamport Clocks

## Status

Partially implemented.

RepTree now has separate move and property clocks and state vectors. Property ops are compacted by `(nodeId, key)`, and the property state vector tracks retained compacted property ops, not full seen property history.

## Summary

RepTree should keep move operations and property operations as distinct streams with separate Lamport clocks and state vectors. Property operations are last-writer-wins (LWW), so RepTree can retain only the latest op per `(nodeId, key)` and avoid carrying full property histories.

## Goals
- Separate **move** and **property** operations into distinct log streams.
- Maintain **independent Lamport clocks** and **state vectors** per stream.
- Allow **LWW property ops to be compacted** to only the latest per `(nodeId, key)`.
- Keep sync semantics correct and deterministic.
- Make it easier to evolve op types (future streams) without affecting others.

## Non-goals
- Redesigning the move CRDT semantics.
- Changing property conflict resolution (still LWW).
- Introducing server-side compaction logic (can be a follow-up).

## Current State

- RepTree has separate move and property clocks.
- RepTree has separate move and property state vectors.
- Move ops are retained in `moveOps`.
- Property ops are compacted in `propertyOpsByKey`.
- State vector comparisons decide which ops to send.

## Proposed Design

### 1. Split op types into distinct streams
Introduce dedicated op logs:
- **Move stream**: structural operations (create/move/delete). Required for tree correctness.
- **Property stream**: LWW property set/unset operations.

Each stream has:
- Independent Lamport counters (per peer): `moveClock`, `propClock`.
- Independent state vectors: `moveStateVector`, `propStateVector`.
- Independent missing-op calculations.

Future extension: add streams for other CRDTs (e.g., text, presence) without impacting existing streams.

### 2. Property ops are LWW and can be compacted

Property operations are LWW by `(nodeId, key)`:

- The latest op by `(counter, peerId)` tiebreak fully represents the state for that key.
- Historical property ops are not required for correctness and can be discarded.

#### Proposed storage shape
- `propLatest: Map<nodeId, Map<key, PropOp>>`
- Optional `propLog` for debugging or audit, but not required for sync.

#### Compaction
- On insert, compare against current latest by LWW order.
- Store only the winning op.
- Maintain `propStateVector` from retained winning ops, not from every seen property op.

### 3. Separate replication flows
Replication exchanges **two state vectors**:
1. Move state vector: send missing move ops.
2. Property state vector: send missing property ops, but only latest per key.

#### Property sync optimization
Instead of shipping all property ops:
- For each peer range missing, filter only the latest ops per `(nodeId, key)` that fall in missing ranges.
- In practice, many keys resolve to a single op per key regardless of history.

### 4. Lamport ordering remains per stream
Lamport ordering is only used within a stream. This avoids cross-stream ordering dependencies:
- Move ops do not need to be ordered relative to property ops.
- Property ops do not need to be ordered relative to moves (except for target existence, handled by applying moves first).

### 5. Sync application order
Apply in the following order for deterministic results:
1. Apply missing move ops (ensure nodes exist/parented).
2. Apply property ops (LWW merges by stream-local clock).

## API/Schema Implications

### State vectors
- Use `stateVectors: { move, prop }`.
- Use `getStateVectors()`.

### Ops serialization
- Existing op shape identifies the stream structurally.
- A future wire format can add an explicit `stream` field if needed.

### Internal changes
- Keep dedicated move and property clocks.
- Keep dedicated move and property state vectors.
- Store properties as latest-op per key.

## Migration Strategy

If persisted logs exist, replay existing operations into the current model. Move ops go into the move log and move state vector. Property ops compact into latest-op storage and retained-dot state vector.

- For compatibility, a version flag in serialized snapshots can indicate stream separation.

## Implications

### Benefits
- **Reduced storage** for properties: only latest value needed.
- **Faster sync**: property replication sends fewer ops.
- **Cleaner modularity**: move and property CRDTs can evolve independently.
- **Scalability**: reduces total op volume in long-lived sessions.

### Trade-offs / Risks

- Complexity: multiple clocks/state vectors to manage.
- Protocol changes: peers need to understand stream separation.
- Edge cases: property ops arriving before a node exists require buffering or applying after move ops.

### Correctness Considerations
- LWW requires deterministic tie-breaking: `(counter, peerId)` within **property stream**.
- Because move ops define structure, they must be applied before property ops when syncing.
- Property compaction must not drop the latest op per key.

### Compatibility & Interop
- Old peers (single stream) require a compatibility layer or a breaking version bump.
- A versioned sync payload can allow dual-mode operation during transition.

### Testing Implications
- New tests for:
  - Independent state vectors per stream.
  - Property compaction and LWW correctness.
  - Sync ordering and correctness when ops interleave.

## Open Questions

- Do we want separate counters per node for properties?
- How should property deletes be represented: tombstone op or explicit unset?

Resolved: property state vectors must not track only latest counter per peer. They track retained compacted property dots, including holes created by evicted older writes.

## Recommendation

Keep the current split-stream model. Future work should focus on explicit wire-versioning and property delete semantics, not on changing property vectors to latest-counter-per-peer.
