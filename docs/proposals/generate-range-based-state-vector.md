# Range-Based State Vector Generation for RepTree

Date: 2025-04-18

## Overview

This proposal outlines how to implement a range-based state vector system for RepTree to enable efficient synchronization between peers. The implementation will leverage RepTree's existing operation structure to generate compact state vectors that track which operations each peer has received.

## Current Operation Structure

RepTree currently maintains operations in two arrays:
- `moveOps`: Array of MoveVertex operations for tree structure
- `setPropertyOps`: Array of SetVertexProperty operations for properties

Each operation contains an `OpId` that has:
- `counter`: A Lamport clock value (sequential integer)
- `peerId`: Unique identifier for the peer that created the operation

## Proposal

We propose adding an incrementally maintained state vector to the RepTree class that tracks all applied operations. Rather than generating the state vector on-demand, it will be updated as operations are applied.

### Implementation Approach

First, we'll add a state vector field to the RepTree class:

```typescript
export class RepTree {
  // Existing fields...
  
  // State vector tracking operations from each peer
  private stateVector: Record<string, number[][]> = {};
  
  // Rest of the class...
}
```

Then, we'll add methods to manage the state vector:

```typescript
/**
 * Updates the state vector with a newly applied operation
 * 
 * @param op The operation that was just applied
 */
private updateStateVector(op: VertexOperation): void {
  const peerId = op.id.peerId;
  const counter = op.id.counter;
  
  // Initialize ranges array for this peer if it doesn't exist
  if (!this.stateVector[peerId]) {
    this.stateVector[peerId] = [];
  }
  
  // Find where to insert or extend a range
  const ranges = this.stateVector[peerId];
  
  // Case 1: No ranges yet
  if (ranges.length === 0) {
    ranges.push([counter, counter]);
    return;
  }
  
  // Try to extend an existing range
  let rangeExtended = false;
  
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    
    // If counter is already in a range, do nothing
    if (counter >= range[0] && counter <= range[1]) {
      return;
    }
    
    // If counter is one less than range start, extend range start
    if (counter === range[0] - 1) {
      range[0] = counter;
      rangeExtended = true;
      break;
    }
    
    // If counter is one more than range end, extend range end
    if (counter === range[1] + 1) {
      range[1] = counter;
      rangeExtended = true;
      
      // Check if this range now overlaps with the next range
      if (i < ranges.length - 1 && range[1] + 1 >= ranges[i + 1][0]) {
        range[1] = ranges[i + 1][1];
        ranges.splice(i + 1, 1);
      }
      
      break;
    }
  }
  
  // If we couldn't extend any range, add a new one
  if (!rangeExtended) {
    // Find the right position to insert (ranges are sorted by start)
    let insertIndex = 0;
    while (insertIndex < ranges.length && ranges[insertIndex][0] < counter) {
      insertIndex++;
    }
    ranges.splice(insertIndex, 0, [counter, counter]);
  }
}

/**
 * Returns the current state vector.
 * Since the state vector is maintained incrementally, this is an O(1) operation.
 */
getStateVector(): Record<string, number[][]> {
  // Return a deep copy to prevent external modifications
  return JSON.parse(JSON.stringify(this.stateVector));
}
```

Next, we need to call `updateStateVector` whenever operations are applied. We can hook this into existing methods:

```typescript
private reportOpAsApplied(op: VertexOperation) {
  this.appliedOps.add(op.id.toString());
  this.updateStateVector(op); // Add this line
  for (const callback of this.opAppliedCallbacks) {
    callback(op);
  }
}
```

### Synchronization Protocol

The synchronization process now becomes more efficient:

1. **Exchange State Vectors**:
   - Peer A sends its state vector to Peer B (`peerA.getStateVector()`)
   - Peer B compares it with its own state vector

2. **Calculate Missing Operations**:
   - Peer B identifies which operations it has that Peer A is missing
   - Peer B sends only these missing operations to Peer A

3. **Apply Operations**:
   - Peer A applies the received operations to its tree
   - Peer A's state vector automatically updates with each applied operation

```typescript
/**
 * Determines which operations are needed to synchronize 
 * with the provided state vector.
 * 
 * @param theirStateVector The state vector from another peer
 * @returns Operations that should be sent to the other peer
 */
getMissingOps(theirStateVector: Record<string, number[][]>): VertexOperation[] {
  // First, identify the missing operation ranges by comparing state vectors
  const missingRanges = this.diffStateVectors(theirStateVector);
  
  // Then, retrieve only the operations that fall within those ranges
  const missingOps: VertexOperation[] = [];
  const allOps = this.getAllOps();
  
  // Only check operations that might be in the missing ranges
  for (const op of allOps) {
    for (const range of missingRanges) {
      if (op.id.peerId === range.peerId && 
          op.id.counter >= range.start && 
          op.id.counter <= range.end) {
        missingOps.push(op);
        break;
      }
    }
  }
  
  return missingOps;
}

/**
 * Calculates which operation ranges we have that the other peer is missing
 * by comparing state vectors.
 * 
 * @param theirStateVector The state vector from another peer
 * @returns Array of operation ID ranges that we have but they don't
 */
private diffStateVectors(theirStateVector: Record<string, number[][]>): OpIdRange[] {
  const missingRanges: OpIdRange[] = [];
  
  // Check what we have that they don't have
  for (const [peerId, ourRanges] of Object.entries(this.stateVector)) {
    const theirRanges = theirStateVector[peerId] || [];
    
    // Calculate ranges we have that they don't
    const missing = subtractRanges(ourRanges, theirRanges);
    
    // Convert to OpIdRange format
    for (const [start, end] of missing) {
      missingRanges.push({
        peerId,
        start,
        end
      });
    }
  }
  
  return missingRanges;
}

/**
 * Helper function to subtract one set of ranges from another
 * Returns the ranges in A that are not in B
 */
function subtractRanges(rangesA: number[][], rangesB: number[][]): number[][] {
  if (rangesB.length === 0) return [...rangesA]; // If B is empty, return all of A
  if (rangesA.length === 0) return []; // If A is empty, nothing to subtract
  
  const result: number[][] = [];
  let indexB = 0;
  
  for (const [startA, endA] of rangesA) {
    let currentStart = startA;
    
    while (indexB < rangesB.length && rangesB[indexB][0] <= endA) {
      // If there's a gap before this range in B
      if (currentStart < rangesB[indexB][0]) {
        result.push([currentStart, rangesB[indexB][0] - 1]);
      }
      
      // Move current start past this range in B
      currentStart = Math.max(currentStart, rangesB[indexB][1] + 1);
      
      // If we've gone past the end of this range in A, break
      if (currentStart > endA) break;
      
      indexB++;
    }
    
    // If there's a remaining gap
    if (currentStart <= endA) {
      result.push([currentStart, endA]);
    }
  }
  
  return result;
}

/**
 * Type definition for operation ID range
 */
interface OpIdRange {
  peerId: string;
  start: number;
  end: number;
}

/**
 * Helper function to check if a counter is in any of the provided ranges
 */
function isCounterInRanges(counter: number, ranges: number[][]): boolean {
  for (const [start, end] of ranges) {
    if (counter >= start && counter <= end) {
      return true;
    }
  }
  return false;
}
```

## Integration with RepTree

To implement this in RepTree, we would:

1. Add the `stateVector` field to the RepTree class
2. Add the `updateStateVector` method to maintain the state vector incrementally 
3. Add the `getStateVector` method to access the current state vector
4. Add `diffStateVectors` and `getMissingOps` methods to efficiently identify operations to send
5. Update the `reportOpAsApplied` method to call `updateStateVector`

### Example Usage

```typescript
// Peer A
const treeA = new RepTree('peer1');
// ... some operations happen on treeA ...
// State vector is automatically maintained

// Peer B
const treeB = new RepTree('peer2');
// ... some operations happen on treeB ...
// State vector is automatically maintained

// Synchronization Process:
// 1. Peer A sends its state vector to Peer B
const stateVectorA = treeA.getStateVector();

// 2. Peer B calculates which operations Peer A is missing
const missingOpsForA = treeB.getMissingOps(stateVectorA);

// 3. Peer B sends the missing operations to Peer A
// 4. Peer A applies those operations
treeA.merge(missingOpsForA);
// State vector is automatically updated as operations are applied
```

## Benefits

1. **Efficient Synchronization**: Only missing operations are transferred
2. **Optimized Comparison**: State vector diff efficiently identifies missing operations
3. **Resilient to Network Partitions**: Peers can handle non-contiguous operation histories
4. **Compact Representation**: State vectors are much smaller than sending all operations
5. **Natural CRDT Integration**: Works with RepTree's existing operation-based CRDT model
6. **Incremental Maintenance**: State vector is maintained as operations are applied, avoiding costly recalculations
7. **Supports Offline Work**: Peers can generate operations locally and reconcile later

## Next Steps

1. Implement the proposed changes in the RepTree class
2. Add unit tests to verify the behavior with various scenarios
3. Create integration tests for multi-peer synchronization
4. Benchmark synchronization efficiency compared to sending all operations
5. Document the public API for developers