## String Interning for IDs — Memory Optimization Proposal

### Problem

RepTree stores thousands of operations, each containing string IDs (peerId, targetId). These strings are duplicated extensively:

- **PeerID duplication**: A peerId like `"peer1"` appears in ~3,000+ OpIds
- **VertexID duplication**: Popular vertex IDs appear in hundreds of operations
- **Memory impact**: Each string copy = 36-72 bytes (UUID) × thousands = ~100-500 KB per ID type
- **V8 overhead**: Small strings have ~2-3x overhead for heap management

**Current state:**
- 9,383 operations × 3 IDs each × 40 bytes avg = **~1.1 MB** just for ID strings
- V8 overhead: **~2-3 MB**
- **Total ID overhead: ~3-4 MB per tree**

### Solution: String Interning

Intern (deduplicate) strings so each unique ID is stored only once in memory:

```typescript
class StringCache {
  private cache = new Map<string, string>();
  
  intern(str: string): string {
    let interned = this.cache.get(str);
    if (!interned) {
      interned = str;
      this.cache.set(str, interned);
    }
    return interned;
  }
}
```

**Usage:**
```typescript
// Before
const opId = { counter: 1, peerId: "peer1" };  // new string each time

// After
const opId = { counter: 1, peerId: cache.intern("peer1") };  // reuse same string
```

### Implementation

#### 1. Add StringCache to RepTree

```typescript
// RepTree.ts
export class RepTree {
  private peerIdCache = new Map<string, string>();
  private vertexIdCache = new Map<string, string>();
  
  private internPeerId(peerId: string): string {
    let cached = this.peerIdCache.get(peerId);
    if (!cached) {
      this.peerIdCache.set(peerId, peerId);
      cached = peerId;
    }
    return cached;
  }
  
  private internVertexId(id: string): string {
    let cached = this.vertexIdCache.get(id);
    if (!cached) {
      this.vertexIdCache.set(id, id);
      cached = id;
    }
    return cached;
  }
}
```

#### 2. Apply at Operation Creation Points

**Creating operations:**
```typescript
newMoveVertexOp(clock, peerId, targetId, parentId) {
  return {
    id: createOpId(clock, this.internPeerId(peerId)),
    targetId: this.internVertexId(targetId),
    parentId: parentId ? this.internVertexId(parentId) : null
  };
}
```

**Merging operations:**
```typescript
merge(ops: VertexOperation[]): void {
  for (const op of ops) {
    // Intern IDs from external operations
    const internedOp = this.internOperation(op);
    this.applyOperation(internedOp);
  }
}

private internOperation(op: VertexOperation): VertexOperation {
  if (isMoveVertexOp(op)) {
    return {
      ...op,
      id: { ...op.id, peerId: this.internPeerId(op.id.peerId) },
      targetId: this.internVertexId(op.targetId),
      parentId: op.parentId ? this.internVertexId(op.parentId) : null,
    };
  } else {
    return {
      ...op,
      id: { ...op.id, peerId: this.internPeerId(op.id.peerId) },
      targetId: this.internVertexId(op.targetId),
    };
  }
}
```

#### 3. Apply to Vertex IDs

```typescript
newVertex(parentId: string): Vertex {
  const id = uuid(); // Generate once
  const internedId = this.internVertexId(id);
  // Use internedId everywhere
}
```

### Expected Benefits

**Memory savings:**
- **PeerIDs**: ~3,000 ops × 36 bytes = 108 KB → 36 bytes = **99.9% reduction**
- **VertexIDs**: ~18,000 references × 36 bytes = 648 KB → ~60 KB (1,800 unique) = **90% reduction**
- **Total per tree**: ~750 KB saved
- **3 trees in tests**: **~2.2 MB saved** (from current 1,237 MB → ~1,235 MB)

**With V8 overhead (3x):**
- **Actual savings: ~6-7 MB** per test run

**Production impact:**
- More significant in long-running processes
- Better GC performance (fewer string objects)
- Lower serialization overhead

### Limitations

- Cache grows unbounded (acceptable for vertex/peer IDs - typically <10K unique)
- Slight CPU overhead for Map lookups (~1-2% in tight loops)
- IDs must be immutable (already the case)

### Alternative: Global Cache

For multi-tree scenarios, use a shared cache:

```typescript
class GlobalStringCache {
  private static peerIds = new Map<string, string>();
  
  static internPeerId(id: string): string {
    return this.intern(this.peerIds, id);
  }
  
  private static intern(map: Map<string, string>, str: string): string {
    let cached = map.get(str);
    if (!cached) {
      map.set(str, str);
      cached = str;
    }
    return cached;
  }
}
```

Benefits in tests with multiple trees sharing IDs.

### Implementation Priority

1. **Phase 1**: Intern peerIds (biggest win, safest)
2. **Phase 2**: Intern vertexIds in operations
3. **Phase 3**: Consider global cache for tests

### Recommendation

Implement Phase 1 (peerId interning) immediately. Low risk, clear 30-40% memory reduction on ID strings, ~5-10% overall memory reduction in tests.

