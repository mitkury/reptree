# Operation Compression in RepTree

## Overview

This proposal outlines an approach for compressing historical operations in RepTree to improve performance, reduce memory usage, and optimize synchronization between peers.

## Problem Statement

As a RepTree instance accumulates operations over time, several challenges emerge:

1. **Memory Overhead**: Storing the complete history of all operations consumes increasing amounts of memory
2. **Synchronization Cost**: New peers joining the network need to receive the entire operation history
3. **Processing Overhead**: Applying a long sequence of operations increases CPU usage and initialization time
4. **Storage Requirements**: Persisting the complete operation history requires more storage space

## Proposed Solution: Operation Compression

We propose implementing an operation compression mechanism that allows RepTree to maintain a compressed representation of its state while preserving the CRDT properties essential for correct replication.

### Core Concepts

#### 1. Compression Point

A "compression point" represents a specific Lamport timestamp up to which all operations are compressed into a snapshot. Operations with timestamps before this point are replaced with a minimal set of equivalent operations that produce the same state.

#### 2. Snapshot Generation

The snapshot generation process:

1. Create a new, empty RepTree instance
2. Generate a minimal set of operations that would construct the current tree state
3. These operations use the same Lamport clock base but are more efficient than the original sequence

#### 3. State Vector Integration

The compression mechanism integrates with the existing state vector system:

- After compression, the state vector is rebuilt to only consider operations past the compression point
- The compressed operations maintain the same causal relationships
- Peers can communicate their compression points during synchronization

### Implementation Approach

#### Compression Algorithm

1. **Identify Compression Candidates**: Determine which operations can be safely compressed (typically operations older than a certain threshold)
2. **Generate Minimal Operation Set**:
   - Create vertex creation operations for all existing vertices
   - Generate property setting operations for current property values
   - Create parent-child relationship operations for the current tree structure
3. **Replace Original Operations**: Substitute the original operations with the compressed set
4. **Update State Vector**: Adjust the state vector to reflect the new operation set

#### Synchronization Protocol Enhancement

1. Include compression point information in synchronization messages
2. When peers have different compression points:
   - The peer with the earlier compression point receives the compressed operations from the peer with the later compression point
   - Operations after both peers' compression points are exchanged normally

## Benefits

1. **Reduced Memory Usage**: Fewer operations to store in memory
2. **Faster Synchronization**: New peers receive a compressed representation rather than full history
3. **Improved Performance**: Fewer operations to process during initialization
4. **Smaller Persistence Footprint**: Less data to store when persisting the tree

## Challenges and Considerations

### 1. Compression Frequency

Determining when to compress operations requires balancing:
- Too frequent: Compression overhead may outweigh benefits
- Too infrequent: Limited memory and performance improvements



### 2. History Preservation

Some applications may require access to the complete operation history:
- Option to disable compression for these use cases
- Potential for archiving compressed operations

### 3. Concurrent Compression

Handling compression in a distributed environment:
- A single authoritative server will be responsible for compression operations
- Clients will not perform compression operations
- The server will distribute compressed state to clients during synchronization

## Implementation Plan

### Phase 1: Core Compression Mechanism

1. Implement snapshot generation algorithm
2. Add compression point tracking
3. Develop compression triggers (manual and automatic)

### Phase 2: Synchronization Integration

1. Extend synchronization protocol to handle compressed operations
2. Implement compression point negotiation between peers

### Phase 3: Configuration and Optimization

1. Add configuration options for compression behavior
2. Optimize compression algorithm for different tree structures
3. Implement adaptive compression based on tree characteristics

## API Considerations

```typescript
// Proposed API additions

interface CompressionOptions {
  // Whether compression is enabled
  enabled: boolean;
  // Minimum number of operations before compression is considered
  minOperationThreshold: number;
  // Maximum age of operations (in terms of newer operations count) before compression
  maxOperationAge: number;
  // Whether to compress automatically or only manually
  automatic: boolean;
}

// RepTree class extensions
class RepTree {
  // ...existing methods...
  
  // Compress operations up to a specific point
  compress(upToTimestamp?: number): void;
  
  // Get information about the current compression state
  getCompressionInfo(): {
    compressionPoint: number | null;
    compressedOperationCount: number;
    totalOperationCount: number;
  };
  
  // Configure compression behavior
  setCompressionOptions(options: Partial<CompressionOptions>): void;
}
```

## Conclusion

Operation compression offers significant benefits for RepTree in terms of performance, memory usage, and synchronization efficiency. By implementing this feature with careful consideration of the challenges, we can enhance RepTree's scalability while maintaining its core CRDT properties.
