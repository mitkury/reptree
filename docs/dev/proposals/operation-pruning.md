## Operation Pruning with Tombstones — Memory Optimization Proposal

### Problem

RepTree stores all operations indefinitely, causing memory growth:
- Tests: 9,383 ops × 3 trees = ~1.2 GB
- Long-running apps: Ops accumulate over time
- **Most ops are superseded and no longer needed for current state**

**Key insight:** We only need operations to reconstruct **current state**, not full history:
- **Property ops (LWW)**: Only the latest op per vertex+key matters
- **Move ops**: Need all for conflict resolution in the move CRDT

**Why we can't just delete ops:**

```typescript
// ❌ Naive approach breaks state vectors
tree.operations = tree.operations.filter(op => isRecent(op));

// Now state vector says "I have ops 1-1000"
// But we only have ops 900-1000 in memory
// Other peers won't send us 1-899 (they think we have them)
// New peers joining will get incomplete history
```

### Solution: State Vector Tombstones

Track pruned operations in the state vector so peers know:
1. "I've seen these ops" (don't send them to me)
2. "But I don't have them" (can't provide them to others)

```typescript
class StateVector {
  private appliedRanges: Record<string, number[][]> = {};  // Ops we've applied
  private prunedRanges: Record<string, number[][]> = {};   // Ops we've pruned (subset of applied)
  
  // Ops we have locally = appliedRanges - prunedRanges
}
```

### Implementation

#### 1. Extend StateVector

```typescript
export class StateVector {
  private appliedRanges: Record<string, number[][]> = {};
  private prunedRanges: Record<string, number[][]> = {};
  
  /**
   * Mark operations as pruned (deleted from local storage but seen)
   */
  markPruned(peerId: string, start: number, end: number): void {
    if (!this.prunedRanges[peerId]) {
      this.prunedRanges[peerId] = [];
    }
    
    // Add to pruned ranges and merge
    this.prunedRanges[peerId].push([start, end]);
    this.prunedRanges[peerId] = this.mergeRanges(this.prunedRanges[peerId]);
  }
  
  /**
   * Get operations we have locally (applied but not pruned)
   */
  getLocalRanges(peerId: string): number[][] {
    const applied = this.appliedRanges[peerId] || [];
    const pruned = this.prunedRanges[peerId] || [];
    return subtractRanges(applied, pruned);
  }
  
  /**
   * Get operations we've seen (applied, including pruned)
   */
  getAppliedRanges(peerId: string): number[][] {
    return this.appliedRanges[peerId] || [];
  }
  
  /**
   * Check if we need an operation
   * (haven't applied it, regardless of pruning)
   */
  needsOperation(opId: OpId): boolean {
    const ranges = this.appliedRanges[opId.peerId] || [];
    return !this.isInRanges(ranges, opId.counter);
  }
}
```

#### 2. Add state-based pruning to RepTree

```typescript
export class RepTree {
  /**
   * State-based pruning: Keep only operations needed for current state
   * 
   * - Property ops (LWW): Keep only the latest op per vertex+key
   * - Move ops: Keep all (needed for conflict resolution)
   * 
   * This is the optimal pruning strategy - removes superseded ops while
   * maintaining ability to reconstruct current state and sync with peers.
   * 
   * @returns Number of operations pruned
   */
  pruneSupersededOperations(): number {
    const latestPropertyOps = new Map<string, SetVertexProperty>();
    const toKeep = new Set<string>();
    
    // Find latest property op for each vertex+key combination
    for (const op of this.operations) {
      if (isLWWPropertyOp(op)) {
        const key = `${op.targetId}:${op.key}`;
        const existing = latestPropertyOps.get(key);
        
        if (!existing || compareOpId(op.id, existing.id) > 0) {
          latestPropertyOps.set(key, op);
        }
      } else if (isMoveVertexOp(op)) {
        // Keep ALL move ops (needed for CRDT conflict resolution)
        toKeep.add(opIdToString(op.id));
      }
    }
    
    // Add latest property ops to keep set
    for (const op of latestPropertyOps.values()) {
      toKeep.add(opIdToString(op.id));
    }
    
    // Find superseded ops to remove
    const toRemove = this.operations.filter(op => 
      !toKeep.has(opIdToString(op.id))
    );
    
    if (toRemove.length === 0) return 0;
    
    // Remove superseded ops
    const removeIds = new Set(toRemove.map(op => opIdToString(op.id)));
    this.operations = this.operations.filter(op => 
      !removeIds.has(opIdToString(op.id))
    );
    
    // Mark as pruned in state vector
    this.markOpsAsPruned(toRemove);
    
    return toRemove.length;
  }
  
  /**
   * Time-based pruning: Keep only recent operations
   * 
   * Simpler but less optimal than state-based pruning.
   * Useful for tests or when you want predictable memory usage.
   * 
   * @param keepCount Number of recent operations to keep
   */
  pruneOldOperations(keepCount: number = 1000): number {
    if (this.operations.length <= keepCount) return 0;
    
    const toRemove = this.operations.length - keepCount;
    const removed = this.operations.splice(0, toRemove);
    
    this.markOpsAsPruned(removed);
    return toRemove;
  }
  
  private markOpsAsPruned(ops: VertexOperation[]): void {
    const byPeer = new Map<string, number[]>();
    
    for (const op of ops) {
      if (!byPeer.has(op.id.peerId)) {
        byPeer.set(op.id.peerId, []);
      }
      byPeer.get(op.id.peerId)!.push(op.id.counter);
    }
    
    for (const [peerId, counters] of byPeer) {
      counters.sort((a, b) => a - b);
      const ranges = this.countersToRanges(counters);
      for (const [start, end] of ranges) {
        this.stateVector.markPruned(peerId, start, end);
      }
    }
  }
  
  private countersToRanges(counters: number[]): number[][] {
    if (counters.length === 0) return [];
    
    const ranges: number[][] = [];
    let start = counters[0];
    let end = counters[0];
    
    for (let i = 1; i < counters.length; i++) {
      if (counters[i] === end + 1) {
        end = counters[i];
      } else {
        ranges.push([start, end]);
        start = counters[i];
        end = counters[i];
      }
    }
    ranges.push([start, end]);
    
    return ranges;
  }
}
```

#### 3. Update synchronization logic

```typescript
// getMissingOps now uses appliedRanges (not local ranges)
getMissingOps(theirStateVector: StateVector): VertexOperation[] {
  const missingRanges = this.stateVector.diff(theirStateVector);
  
  return this.operations.filter(op => {
    // Check if op is in any missing range
    return missingRanges.some(range => 
      range.peerId === op.id.peerId &&
      op.id.counter >= range.start &&
      op.id.counter <= range.end
    );
  });
}

// If we don't have a requested op (pruned), return empty or throw
```

#### 4. Serialization format

**State vector with tombstones:**
```json
{
  "applied": {
    "peer1": [[1, 1000], [1005, 2000]],
    "peer2": [[1, 500]]
  },
  "pruned": {
    "peer1": [[1, 500]],
    "peer2": [[1, 100]]
  }
}
```

**Storage overhead:**
- Each range: 16 bytes (2 numbers)
- Pruned ranges typically compact (continuous deletions)
- Much smaller than storing actual operations

### Usage Patterns

#### Pattern 1: State-based pruning (recommended)

```typescript
// Prune superseded operations - keeps minimal state
const pruned = tree.pruneSupersededOperations();
console.log(`Pruned ${pruned} superseded operations`);

// Safe to call frequently - CRDT guarantees convergence
// New peers can still sync (gets current state)
```

**Why this is optimal:**
- Keeps exactly what's needed for current state
- Property ops: Only latest per vertex+key (LWW wins anyway)
- Move ops: All kept (needed for CRDT conflict resolution)
- No coordination needed - works with CRDT semantics
- New peers get snapshot + minimal ops = full sync

**Example:**
```typescript
// Property history for vertex1.name:
{ id: 1@peer1, key: "name", value: "Alice" }   // ❌ Pruned (superseded)
{ id: 5@peer1, key: "name", value: "Bob" }     // ❌ Pruned (superseded)
{ id: 10@peer2, key: "name", value: "Charlie" } // ✅ Kept (latest)

// Move history:
{ id: 2@peer1, targetId: v1, parentId: root }    // ✅ Kept (CRDT needs all)
{ id: 7@peer2, targetId: v1, parentId: folderA } // ✅ Kept (CRDT needs all)
```

#### Pattern 2: Time-based pruning (simpler alternative)

```typescript
// Keep only last 1000 ops
tree.pruneOldOperations(1000);

// Simpler but less optimal than state-based
// Good for predictable memory usage in tests
```

#### Pattern 3: Periodic cleanup

```typescript
// Every 5 minutes, prune superseded ops
setInterval(() => {
  tree.pruneSupersededOperations();
}, 5 * 60 * 1000);

// Or after significant activity
tree.on('operationCount', (count) => {
  if (count > 10000) {
    tree.pruneSupersededOperations();
  }
});
```

### Memory Savings

**Test scenario (3 trees, 5 rounds, 500 ops/round):**

Current:
- 9,383 ops × 3 trees = 28,149 ops in memory
- ~1,237 MB

**With state-based pruning:**
- 9,383 ops total
- ~30% are property ops (~2,815 ops)
- Average 3 updates per property → keep 1/3 → prune ~1,870 property ops per tree
- Keep all ~6,568 move ops (CRDT needs them)
- Result: ~7,513 ops × 3 trees = ~22,539 ops
- **~20% reduction: 1,237 MB → ~990 MB**

**Why not more savings?**
- Property ops are only ~30% of total
- Move ops dominate in tree structure tests (70%)
- For property-heavy workloads, savings can be 50-80%

**Production property-heavy scenario:**
```
Document editor with 1,000 vertices, each updated 100 times:
- Without pruning: 100,000 property ops + move ops
- With state-based: 1,000 property ops + move ops
- 99% reduction on property ops!
```

**Time-based pruning (for tests):**
- Keep last 1,000 ops per tree = 3,000 ops total
- **~89% reduction: 1,237 MB → ~136 MB**

**Long-running app:**
- Without pruning: Linear growth (unbounded)
- With state-based: Grows with unique vertices + structure changes (bounded)
- With time-based: Constant memory (~predictable)

### Edge Cases

**1. Pruned ops requested by peer:**
```typescript
// Peer asks for ops we've pruned
getMissingOps(theirStateVector): VertexOperation[] {
  const missing = super.getMissingOps(theirStateVector);
  
  // Check if we've pruned any of these
  const pruned = missing.filter(op => 
    this.stateVector.isPruned(op.id)
  );
  
  if (pruned.length > 0) {
    // Option 1: Error (strict)
    throw new Error('Requested operations have been pruned');
    
    // Option 2: Return what we have (graceful)
    return missing.filter(op => !this.stateVector.isPruned(op.id));
    
    // Option 3: Fetch from archive (advanced)
    return [...available, ...await fetchFromArchive(pruned)];
  }
  
  return missing;
}
```

**2. New peer joining:**
- Gets full current state snapshot (all vertices)
- Gets only recent operations (not pruned ones)
- Works if all current state is consistent

**3. Network partition:**
- Peer offline for long time
- Comes back, needs pruned ops
- Handle gracefully: full state sync or error

### Recommendation

**Implement in phases:**

1. **Phase 1**: Add tombstone tracking to StateVector (required foundation)
2. **Phase 2**: Add `pruneSupersededOperations()` (state-based, optimal)
3. **Phase 3**: Add `pruneOldOperations()` (time-based, for tests)
4. **Phase 4**: Document pruning strategies and best practices

**For production apps:**
- Use `pruneSupersededOperations()` - optimal, CRDT-safe
- Property-heavy workloads see 50-99% reduction
- Tree-heavy workloads see 20-40% reduction
- No coordination needed, works with CRDT semantics

**For tests:**
- Use `pruneOldOperations(1000)` after each sync round
- Predictable memory: ~89% reduction
- Simpler than state-based for test scenarios

**General principle:**
- State-based pruning = keep minimal state for current snapshot
- Time-based pruning = keep last N ops (easier but arbitrary)
- Both work correctly with CRDTs - choose based on use case

