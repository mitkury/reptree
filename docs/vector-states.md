# Range-Based State Vectors in RepTree

## Overview

RepTree uses range-based state vectors to track which operations are available for synchronization across peers. This approach allows for compact representation of operation history and optimized synchronization by identifying only the missing operations that need to be transferred.

## Implementation

### State Vector Structure

RepTree keeps separate state vectors for move operations and property operations:

```typescript
type StateVectors = {
  move: Record<string, number[][]>;
  prop: Record<string, number[][]>;
};

// Example:
// {
//   move: { "peer1": [[1, 5], [8, 10]], "peer2": [[1, 7]] },
//   prop: { "peer1": [[1, 12]], "peer2": [[1, 4]] }
// }
```

Each range `[start, end]` represents a continuous sequence of operations with counters from `start` to `end` (inclusive) that have been applied from that peer.

Move and property operations use independent counters, so the same peer/counter pair can exist in both streams. Operation IDs are unique within a stream, not globally across all operation types.

RepTree encapsulates range handling in a dedicated `StateVector` class and exposes the pair through `getStateVectors()`.

### Key Algorithms

#### Incremental Maintenance

Each state vector is updated as operations in that stream are applied or retained for sync:

1. When an operation is applied, its peer ID and counter are extracted
2. The corresponding range array for that peer in the operation stream is located or created
3. The system then either:
   - Extends an existing range if the counter is adjacent to it
   - Merges ranges if extending one range connects it to another
   - Creates a new range if the counter isn't adjacent to any existing range

#### Range Operations

The system includes a `subtractRanges` helper function that calculates the set difference between two range sets. This is used to determine which operations one peer has that another doesn't.

#### Missing Operations Calculation

To determine what operations to send during synchronization:

1. Calculate missing ranges by comparing move state vectors and property state vectors separately
2. Filter move operations and compacted property operations to find those falling within these missing ranges
3. Sort resulting operations within each stream to preserve deterministic ordering

## Benefits

1. **Compact Representation**: Continuous sequences of operations are represented as single ranges
2. **Efficient Synchronization**: Only missing operations are transferred between peers
3. **Handles Gaps**: Non-contiguous operations are efficiently represented as separate ranges
4. **Incremental Updates**: State vectors are maintained as syncable operations are applied
5. **Modular Design**: Separation of concerns with a dedicated StateVector class

## Synchronization Protocol

1. Peer A sends its state vectors to Peer B
2. Peer B calculates missing operations by comparing move and property state vectors
3. Peer B sends only the missing operations to Peer A
4. Peer A applies these operations, automatically updating its state vectors

This approach minimizes network usage and ensures efficient operation transfer during synchronization.

## Usage in RepTree

The state vector functionality in RepTree:

- Is enabled by default
- Can be toggled on/off with the `stateVectorEnabled` property
- Will automatically rebuild from existing operations when re-enabled
- Uses `getStateVectors()` and `getMissingOps(stateVectors)` for range-based synchronization

Property operations are last-writer-wins and are compacted to the latest operation per `(nodeId, key)`. The property state vector represents the retained compacted property operations that can be sent during sync, not a full audit history of every property write.
