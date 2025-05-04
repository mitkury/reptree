import { OpId } from "./OpId";
import type { OpIdRange } from "./treeTypes";
import type { VertexOperation } from "./operations";

/**
 * Helper function to subtract one set of ranges from another.
 * Returns the ranges in A that are not in B.
 * Assumes ranges in both A and B are sorted and non-overlapping.
 */
export function subtractRanges(rangesA: number[][], rangesB: number[][]): number[][] {
  if (rangesB.length === 0) return rangesA.map(r => [...r]); // Return a copy
  if (rangesA.length === 0) return []; // If A is empty, nothing to subtract

  const result: number[][] = [];
  let indexB = 0;

  for (const rangeA of rangesA) {
    let currentStart = rangeA[0];
    const endA = rangeA[1];

    // Iterate through ranges in B that could potentially overlap with rangeA
    while (indexB < rangesB.length && rangesB[indexB][1] < currentStart) {
      // Skip ranges in B that are entirely before the current start
      indexB++;
    }

    while (indexB < rangesB.length && rangesB[indexB][0] <= endA) {
      const startB = rangesB[indexB][0];
      const endB = rangesB[indexB][1];

      // If there's a gap before this range in B starts
      if (currentStart < startB) {
        // Add the portion of rangeA before the overlap
        result.push([currentStart, Math.min(endA, startB - 1)]);
      }

      // Move current start past this range in B
      currentStart = Math.max(currentStart, endB + 1);

      // If we've gone past the end of rangeA, break inner loop
      if (currentStart > endA) break;

      // If the current rangeB ends after rangeA, we don't need to check further ranges in B for this rangeA
      if (endB >= endA) break;

      // Only advance indexB if the current rangeB is fully processed relative to currentStart
      if (endB < currentStart) {
        indexB++;
      } else if (startB >= currentStart) {
        indexB++;
      }
    }

    // If there's a remaining part of rangeA after processing overlaps with B
    if (currentStart <= endA) {
      result.push([currentStart, endA]);
    }
  }

  return result;
}

/**
 * StateVector tracks operations that have been applied using a range-based representation.
 * It's used for synchronization between peers to determine which operations need to be sent.
 */
export class StateVector {
  private ranges: Record<string, number[][]> = {};

  /**
   * Creates a new StateVector.
   * @param initialState Optional initial state to copy from
   */
  constructor(initialState: Record<string, number[][]> = {}) {
    // Create a deep copy of the initial state
    for (const [peerId, peerRanges] of Object.entries(initialState)) {
      this.ranges[peerId] = peerRanges.map(range => [...range]);
    }
  }

  /**
   * Updates the state vector with a newly applied operation.
   * Assumes ranges are sorted and non-overlapping.
   * 
   * @param peerId The peer ID of the operation
   * @param counter The counter value of the operation
   */
  update(peerId: string, counter: number): void {
    // Initialize ranges array for this peer if it doesn't exist
    if (!this.ranges[peerId]) {
      this.ranges[peerId] = [];
    }

    const ranges = this.ranges[peerId];

    // Case 1: No ranges yet
    if (ranges.length === 0) {
      ranges.push([counter, counter]);
      return;
    }

    let rangeExtendedOrMerged = false;
    let insertIndex = -1;

    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];

      // If counter is already in a range, do nothing
      if (counter >= range[0] && counter <= range[1]) {
        rangeExtendedOrMerged = true;
        break;
      }

      // If counter is one less than range start, extend range start
      if (counter === range[0] - 1) {
        range[0] = counter;
        rangeExtendedOrMerged = true;
        // Check if this range now merges with the previous range
        if (i > 0 && range[0] === ranges[i - 1][1] + 1) {
          ranges[i - 1][1] = range[1]; // Merge into previous
          ranges.splice(i, 1); // Remove current
        }
        break;
      }

      // If counter is one more than range end, extend range end
      if (counter === range[1] + 1) {
        range[1] = counter;
        rangeExtendedOrMerged = true;
        // Check if this range now merges with the next range
        if (i < ranges.length - 1 && range[1] + 1 === ranges[i + 1][0]) {
          range[1] = ranges[i + 1][1]; // Merge next into current
          ranges.splice(i + 1, 1); // Remove next
        }
        break;
      }

      // Keep track of where to insert if no extension/merge happens
      if (counter < range[0] && insertIndex === -1) {
        insertIndex = i;
      }
    }

    // If we couldn't extend or merge any range, add a new one
    if (!rangeExtendedOrMerged) {
      if (insertIndex === -1) {
        // If counter is greater than all existing ranges, add to the end
        insertIndex = ranges.length;
      }
      ranges.splice(insertIndex, 0, [counter, counter]);
      // After inserting, check if the new range merges with neighbors
      // Merge with previous range if possible
      if (insertIndex > 0 && ranges[insertIndex][0] === ranges[insertIndex - 1][1] + 1) {
        ranges[insertIndex - 1][1] = ranges[insertIndex][1];
        ranges.splice(insertIndex, 1);
        insertIndex--; // Adjust index after merging
      }
      // Merge with next range if possible (use adjusted insertIndex)
      if (insertIndex < ranges.length - 1 && ranges[insertIndex][1] + 1 === ranges[insertIndex + 1][0]) {
        ranges[insertIndex][1] = ranges[insertIndex + 1][1];
        ranges.splice(insertIndex + 1, 1);
      }
    }
  }

  /**
   * Updates the state vector with a newly applied operation.
   * 
   * @param op The operation that was just applied
   */
  updateFromOp(op: VertexOperation): void {
    this.update(op.id.peerId, op.id.counter);
  }

  /**
   * Returns the current state vector.
   * Returns a readonly reference to the internal state.
   */
  getState(): Readonly<Record<string, number[][]>> {
    return this.ranges;
  }

  /**
   * Calculates which operation ranges we have that the other state vector is missing
   * by comparing state vectors.
   * 
   * @param other The other state vector to compare against
   * @returns Array of operation ID ranges that we have but they don't
   */
  diff(other: StateVector): OpIdRange[] {
    const missingRanges: OpIdRange[] = [];
    const theirState = other.getState();

    // Check what we have that they don't have
    for (const [peerId, ourRanges] of Object.entries(this.ranges)) {
      const theirRanges = theirState[peerId] || [];

      // Calculate ranges we have that they don't
      const missing = subtractRanges(ourRanges, theirRanges);

      // Convert to OpIdRange format
      for (const [start, end] of missing) {
        // Ensure the range is valid (start <= end)
        if (start <= end) {
          missingRanges.push({
            peerId,
            start,
            end
          });
        }
      }
    }

    return missingRanges;
  }

  /**
   * Checks if the state vector contains the given operation ID
   * 
   * @param opId The operation ID to check
   * @returns true if the operation is in the state vector, false otherwise
   */
  contains(opId: OpId): boolean {
    const peerId = opId.peerId;
    const counter = opId.counter;

    if (!this.ranges[peerId]) {
      return false;
    }

    for (const [start, end] of this.ranges[peerId]) {
      if (counter >= start && counter <= end) {
        return true;
      }
    }

    return false;
  }

  /**
   * Creates a copy of this state vector
   */
  clone(): StateVector {
    return new StateVector(this.ranges);
  }

  /**
   * Builds a state vector from an array of operations
   * @param operations The operations to build the state vector from
   * @returns A new StateVector instance
   */
  static fromOperations(operations: ReadonlyArray<VertexOperation>): StateVector {
    const stateVector = new StateVector();
    for (const op of operations) {
      stateVector.updateFromOp(op);
    }
    return stateVector;
  }
} 