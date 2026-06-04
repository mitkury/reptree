# Proposal: Separate Operation Streams and Lamport Clocks

## Summary
RepTree currently treats all operations as a single sequence with a single Lamport counter per peer. This proposal suggests splitting operations into distinct streams—at minimum **move operations** and **property operations**—with separate Lamport clocks and state vectors. Property operations are last-writer-wins (LWW), so we can retain only the latest op per `(nodeId, key)` and avoid carrying full property histories. This separation improves storage efficiency and sync performance while preserving correctness.

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

## Current State (High-Level)
- A single Lamport counter per peer is used across all ops.
- A single state vector tracks applied operations.
- Property ops are stored and synced alongside move ops.
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
- The **latest op** (by `(counter, peerId)` tiebreak) fully represents the state for that key.
- Historical property ops are not required for correctness and can be discarded.

#### Proposed storage shape
- `propLatest: Map<nodeId, Map<key, PropOp>>`
- Optional `propLog` for debugging or audit, but not required for sync.

#### Compaction
- On insert, compare against current latest by LWW order.
- Store only the winning op.
- Optionally record last-seen counter per peer for state vectors.

### 3. Separate replication flows
Replication exchanges **two state vectors**:
1. Move state vector → send missing move ops.
2. Property state vector → send missing property ops (but only latest per key).

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
- Replace single `stateVector` with `stateVectors: { move, prop }`.
- `getStateVector()` becomes `getStateVectors()` or a versioned payload.

### Ops serialization
- `op.type` should identify stream (`move` or `prop`).
- Ops are stored/sent with `stream` field to select the correct state vector.

### Internal changes
- Introduce `MoveClock` and `PropClock` (per peer).
- Dedicated `MoveStateVector` and `PropStateVector`.
- Property store switches from op log to **latest-op per key** storage.

## Migration Strategy
- If persisted logs exist, we can replay existing operations into the new model:
  - Move ops → move log/state vector.
  - Property ops → compact into `propLatest` while updating prop state vector.
- For compatibility, a version flag in serialized snapshots can indicate stream separation.

## Implications

### Benefits
- **Reduced storage** for properties: only latest value needed.
- **Faster sync**: property replication sends fewer ops.
- **Cleaner modularity**: move and property CRDTs can evolve independently.
- **Scalability**: reduces total op volume in long-lived sessions.

### Trade-offs / Risks
- **Complexity**: multiple clocks/state vectors to manage.
- **Protocol changes**: peers need to understand stream separation.
- **Edge cases**: property ops arriving before a node exists (requires buffering or applying after move ops).

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
- Do we want separate counters per **node** for properties (optional optimization)?
- Should property state vector track **latest counter per peer** only, even if we compact ops?
- How to represent property deletes (e.g., tombstone op vs explicit unset)?

## Recommendation
Proceed with a phased implementation:
1. Introduce stream-aware op schema and dual state vectors.
2. Split clocks and logging per stream.
3. Implement property compaction to retain only latest per key.
4. Add migration/compat layer or version bump for existing consumers.
