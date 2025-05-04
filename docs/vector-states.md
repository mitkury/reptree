# Range-Based State Vectors in RepTree

## Overview

RepTree uses range-based state vectors to track which operations have been applied across peers. This approach allows for compact representation of operation history and optimized synchronization by identifying only the missing operations that need to be transferred.

## Implementation

### State Vector Structure

A state vector is represented as a mapping from peer IDs to arrays of ranges:

```typescript
// Type: Record<peerId, number[][]>
// Example: { "peer1": [[1, 5], [8, 10]], "peer2": [[1, 7]] }
```

Each range `[start, end]` represents a continuous sequence of operations with counters from `start` to `end` (inclusive) that have been applied from that peer.

RepTree encapsulates this functionality in a dedicated `StateVector` class that handles all state vector operations, providing a clean interface for the rest of the system.

### Key Algorithms

#### Incremental Maintenance

The state vector is continuously updated as operations are applied:

1. When an operation is applied, its peer ID and counter are extracted
2. The corresponding range array for that peer is located or created
3. The system then either:
   - Extends an existing range if the counter is adjacent to it
   - Merges ranges if extending one range connects it to another
   - Creates a new range if the counter isn't adjacent to any existing range

#### Range Operations

The system includes a `subtractRanges` helper function that calculates the set difference between two range sets. This is used to determine which operations one peer has that another doesn't.

#### Missing Operations Calculation

To determine what operations to send during synchronization:

1. Calculate missing ranges by comparing state vectors to identify ranges one peer has that the other doesn't
2. Filter all operations to find those falling within these missing ranges
3. Sort the resulting operations to ensure causal order preservation

## Benefits

1. **Compact Representation**: Continuous sequences of operations are represented as single ranges
2. **Efficient Synchronization**: Only missing operations are transferred between peers
3. **Handles Gaps**: Non-contiguous operations are efficiently represented as separate ranges
4. **Incremental Updates**: State vectors are maintained in real-time as operations are applied
5. **Modular Design**: Separation of concerns with a dedicated StateVector class

## Synchronization Protocol

1. Peer A sends its state vector to Peer B
2. Peer B calculates missing operations by comparing state vectors
3. Peer B sends only the missing operations to Peer A
4. Peer A applies these operations, automatically updating its state vector

This approach minimizes network usage and ensures efficient operation transfer during synchronization.

## Usage in RepTree

The state vector functionality in RepTree:

- Is enabled by default
- Can be toggled on/off with the `stateVectorEnabled` property
- Will automatically rebuild from existing operations when re-enabled