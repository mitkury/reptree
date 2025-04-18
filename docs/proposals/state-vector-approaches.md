# State Vector Approaches for RepTree

Date: 2025-04-19

## Overview

State vectors are critical for efficient synchronization in distributed systems. This document presents different approaches to implementing state vectors in RepTree, focusing on how they track and communicate operation history between peers.

## Proposed Range-Based State Vector

A range-based state vector tracks contiguous and non-contiguous sequences of operations from each peer. The top-level keys represent the origin peer (the peer that generated the operations), and the values represent the counters of operations created by that peer:

```
// Example representation
{
  "peer1": [[0,3], [999]],   // Operations created by peer1 with counters 0-3 and 999 (e.g., 0@peer1, 1@peer1, 2@peer1, 3@peer1, 999@peer1)
  "peer2": [[0,50]]          // Operations created by peer2 with counters 0-50 (e.g., 0@peer2, 1@peer2, ..., 50@peer2)
}
```

### Example Scenario

1. **Initial State**: 
   ```
   {"peer1": [[0,3]], "peer2": [[0,50]]}
   ```

2. **Receive op 999 from peer1**:
   ```
   {"peer1": [[0,3], [999]], "peer2": [[0,50]]}
   ```

3. **Receive ops 4-998 from peer1**:
   ```
   {"peer1": [[0,999]], "peer2": [[0,50]]}
   ```

4. **Merging with another peer's state**:
   ```
   // Local: {"peer1": [[0,999]], "peer2": [[0,50]]}
   // Remote: {"peer1": [[0,500]], "peer2": [[0,100]]}
   // Result: {"peer1": [[0,999]], "peer2": [[0,100]]}
   ```

5. **Synchronization request example**:
   ```
   // Peer3 with state vector: {"peer1": [[0,3]], "peer2": [], "peer3": [[0,20]]}
   // Connects to Peer1 with state vector: {"peer1": [[0,100]], "peer2": [[0,50]], "peer3": []}
   
   // Peer3 would request:
   // - From peer1: Operations 4-100 (since it only has 0-3)
   // - From peer2: Operations 0-50 (since it has none)
   
   // Peer1 would request:
   // - From peer3: Operations 0-20 (since it has none)
   ```

### Benefits

- **Supports Non-Contiguous History**: Peers can function with operation gaps
- **Efficient Representation**: More compact for sparse operation sets
- **Flexible Synchronization**: Works well with intermittent connectivity
- **CRDT Compatible**: Works perfectly with RepTree's CRDT model
- **Preserves Intent**: Operations can be applied when received regardless of gaps

### Implementation

Operations could be applied immediately upon receipt, regardless of gaps. When missing operations later arrive, RepTree's CRDT properties ensure consistency.

## Alternative Approaches

### 1. Simple Clock Vector (Yjs Approach)

Tracks the highest continuous clock seen from each peer:

```
{
  "peer1": 3,    // Operations 0-3 from peer1
  "peer2": 50    // Operations 0-50 from peer2
}
```

### Example Scenario

1. **Initial State**:
   ```
   {"peer1": 3, "peer2": 50}
   ```

2. **Receive op 999 from peer1**:
   ```
   // State remains {"peer1": 3, "peer2": 50}
   // Op 999 is queued until ops 4-998 are received
   ```

3. **Receive ops 4-100 from peer1**:
   ```
   {"peer1": 100, "peer2": 50}
   // Ops 4-100 are applied, but op 999 remains queued
   ```

4. **Merging with another peer's state**:
   ```
   // Local: {"peer1": 100, "peer2": 50}
   // Remote: {"peer1": 50, "peer2": 100}
   // Result: {"peer1": 100, "peer2": 100} 
   // Each takes the maximum continuous clock
   ```

Operations with clock values beyond the continuous range are queued until the gap is filled.

### 2. Dotted Version Vectors (DVVs)

Represents a contiguous prefix plus individual dots (operations):

```
{
  "peer1": {base: 3, dots: [999]},
  "peer2": {base: 50, dots: []}
}
```

### Example Scenario

1. **Initial State**:
   ```
   {"peer1": {base: 3, dots: []}, "peer2": {base: 50, dots: []}}
   ```

2. **Receive op 999 from peer1**:
   ```
   {"peer1": {base: 3, dots: [999]}, "peer2": {base: 50, dots: []}}
   ```

3. **Receive ops 4-15 from peer1**:
   ```
   {"peer1": {base: 15, dots: [999]}, "peer2": {base: 50, dots: []}}
   ```

4. **Merging with another peer's state**:
   ```
   // Local: {"peer1": {base: 15, dots: [999]}, "peer2": {base: 50, dots: []}}
   // Remote: {"peer1": {base: 10, dots: [20, 30]}, "peer2": {base: 60, dots: []}}
   // Result: {"peer1": {base: 15, dots: [20, 30, 999]}, "peer2": {base: 60, dots: []}}
   ```

DVVs become inefficient when there are many operations beyond the base, as each must be listed individually.

### 3. Interval Tree Clocks

Uses tree structures to efficiently encode complex ranges and exceptions.

### Example

```
// Simplified representation - actual ITCs use binary trees 
{
  "stamps": [
    {id: "10", range: [0, 10]},
    {id: "01", range: [5, 15]}
  ]
}
```

ITCs use a fork-event model with sophisticated tree structures that can be split and joined, making them powerful but more complex to implement.

### 4. Bloom Clock Filters

Probabilistic data structures that efficiently encode membership of operations.

### Example

```
// Conceptual representation - actual Bloom filters are bit arrays
{
  "filter": BloomFilter(size=1024, functions=5),  // Contains ops 1, 3, 5, 999
  "certainty": 0.997                              // 0.3% false positive rate
}
```

Bloom filters provide space efficiency at the cost of possible false positives when checking for operation membership.

## Application to RepTree

RepTree's operation-based CRDT model is well-suited for the range-based approach since:

1. Operations are already designed to be applied regardless of order
2. The Lamport clock already provides causal ordering when needed
3. The explicit parent/child relationships in the tree structure help maintain consistency

## Recommendation

The range-based state vector approach offers the best balance of efficiency and flexibility for RepTree's synchronization needs. It leverages RepTree's existing CRDT properties while providing more resilient network behavior. 