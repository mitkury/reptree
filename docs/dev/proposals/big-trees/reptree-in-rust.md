## **RepTree-RS: Rust Implementation Specification**

### 1. Architecture Overview

| Layer               | Technology                               | Role                                                   |
| ------------------- | ---------------------------------------- | ------------------------------------------------------ |
| JavaScript Thin API | TypeScript + Zod                         | Sync, optimistic vertex objects, small cache, undo log |
| Interface Bridge    | Web Worker (WASM) / Tauri plugin / N-API | Message channel between JS and Rust                    |
| RepTree Core        | Rust + yrs                               | CRDT engine, conflict resolution, disk/remote storage  |

```
 JS main thread
 ┌───────────────┐           postMessage / invoke / N-API
 │  Typed Proxy  │◄────────────── Patch
 │  Thin Vertex  │────────┐       Ack/Nack
 └───────────────┘        │
        ▲  undo rollback  │
        │                 ▼
 ┌─────────────────────────────────────────┐
 │     Worker / Native Process (Rust)      │
 │  ┌───────────┐  ┌─────────────┐         │
 │  │ Move CRDT │  │ yrs CRDTs   │         │
 │  └───────────┘  └─────────────┘         │
 │  ┌───────────┐  ┌─────────────┐         │
 │  │  Cache    │  │  Storage    │         │
 │  └───────────┘  └─────────────┘         │
 └─────────────────────────────────────────┘
```

---

### 2. Rust Core Components

```rust
pub struct RepTree {
    peer_id: String,
    state: TreeState,                        // materialized snapshot
    move_log: Box<dyn MoveLogStore>,
    prop_log: Box<dyn PropLogStore>,
    cache: lru::LruCache<String, EncodedVertex>,
    lamport: u64,
    state_vector: StateVector,               // for peer sync
}

impl RepTree {
    pub async fn new(peer: &str, cfg: StorageConfig) -> Result<Self>;
    pub async fn apply_op(&mut self, op: VertexOperation) -> Result<OpId, ValidationError>;
    pub async fn get_vertex(&mut self, id: &str) -> Option<EncodedVertex>;
    pub async fn get_children(&mut self, parent_id: &str, after: Option<i64>, limit: u32) 
        -> Result<Vec<EncodedVertex>>;
    pub async fn handle_sync_request(&mut self, from_peer: &str, their_state: StateVector);
}
```

#### 2.1. CRDT Integration

```rust
// Move Tree CRDT for structure
pub struct MoveVertex {
    id: OpId,
    target_id: String,
    parent_id: Option<String>,
    timestamp: u64,
}

// Property handling with yrs
pub enum VertexPropertyValue {
    Primitive(PrimitiveValue),
    YDoc(yrs::Doc),
    YArray(yrs::Array),
    YMap(yrs::Map),
    YText(yrs::Text),
}
```

#### 2.2. Storage Adapters

```rust
pub trait VertexStore: Send + Sync {
    async fn get_vertex(&self, id: &str) -> Result<Option<EncodedVertex>>;
    async fn put_vertex(&self, v: EncodedVertex) -> Result<()>;
    async fn get_children_page(&self, parent: &str, after: Option<i64>, limit: u32)
        -> Result<Vec<(String, i64)>>;
}

pub trait LogStore<T>: Send + Sync {
    async fn append(&self, op: T) -> Result<u64>;           // returns seq
    async fn latest_seq(&self) -> Result<u64>;
    async fn scan_range(&self, opts: ScanOpts) -> ScanStream<'_, T>;
}
```

Default backend: SQLite tables `vertices`, `move_ops`, `prop_ops` with `(parent_id, idx)` composite index for seek-pagination.

#### 2.3. Background Folding

A task runs every 5s or 1000 ops to maintain the materialized snapshot:

```rust
loop {
    let batch = move_log.scan_range({...}).await.collect::<Vec<_>>();
    if batch.is_empty() { sleep(5s); continue; }
    state.apply_moves(&batch);
    vertex_store.put_vertices(state.dirty()).await?;
}
```

---

### 3. Interface Layer

#### 3.1. Message Protocol

```typescript
// Higher-level operations from JS to Rust
type JsToRustOperation = 
  | { type: "createVertex"; parentId: string; properties?: Record<string, any>; id?: string }
  | { type: "moveVertex"; vertexId: string; newParentId: string }
  | { type: "deleteVertex"; vertexId: string }
  | { type: "setProperty"; vertexId: string; key: string; value: any }
  | { type: "removeProperty"; vertexId: string; key: string };

// JS → Rust
interface JsOpMsg  { type: "operation"; cid: number; op: JsToRustOperation }
interface FetchMsg { type: "getVertex" | "getChildren"; id: string; after?: number; limit?: number }
interface SubMsg   { type: "subscribeVertex"; id: string }
interface UnsubMsg { type: "unsubscribeVertex"; id: string }
interface SyncMsg  { type: "syncWithPeer"; peerId: string; transport: "websocket" | "webrtc" | "custom" }
type JsToRust = JsOpMsg | FetchMsg | SubMsg | UnsubMsg | SyncMsg

// Rust → JS
interface AckMsg    { type: "ack"; cid: number }
interface NackMsg   { type: "nack"; cid: number; reason: string }
interface VertexMsg { type: "vertexUpdate"; id: string; data: VertexData }
interface DeleteMsg { type: "vertexDeleted"; id: string }
type RustToJs = AckMsg | NackMsg | VertexMsg | DeleteMsg
```

#### 3.2. WebAssembly Binding

```typescript
// WASM exports
interface RepTreeWasm {
  createRepTree(peerId: string, config: string): number; // Returns handle
  applyOperation(handle: number, opJson: string): string; // Returns result JSON
  getVertex(handle: number, id: string): string; // Returns vertex JSON
  getChildren(handle: number, parentId: string, after: number | null, limit: number): string;
  subscribeVertex(handle: number, id: string): void;
  // Other methods
}
```

#### 3.3. Tauri Integration

```rust
#[tauri::command]
fn create_reptree(peer_id: String, config: String) -> Result<String, String> {
    // Create RepTree instance and return handle
}

#[tauri::command]
fn apply_operation(handle: String, op_json: String) -> Result<String, String> {
    // Apply operation to RepTree instance
}

// Other commands
```

---

### 4. JavaScript Façade

#### 4.1. ThinRepTree

```typescript
class ThinRepTree {
  private cid = 0;
  private undoLog = new Map<number, JsToRustOperation[]>();
  private cache = new LRU<string, VertexData>({ max: 50000 });
  private subscriptions = new Set<string>();
  private observers = new Map<string, Set<(data: VertexData) => void>>();
  
  constructor(public peerId: string, options: RepTreeOptions) {
    // Initialize worker or native bridge
    this.setupBridge();
  }
  
  commit(op: JsToRustOperation) {
    const id = ++this.cid;
    const inverse = this.calculateInverse(op);
    
    if (!this.undoLog.has(id)) {
      this.undoLog.set(id, []);
    }
    this.undoLog.get(id)!.push(inverse);
    
    this.applyLocally(op);
    this.bridge.post({ type: "operation", cid: id, op });
    
    return id;
  }
  
  subscribeToVertex(id: string) {
    if (!this.subscriptions.has(id)) {
      this.subscriptions.add(id);
      this.bridge.post({ type: "subscribeVertex", id });
    }
    return this;
  }
  
  private handleMessage(msg: RustToJs) {
    if (msg.type === "ack") {
      this.undoLog.delete(msg.cid);
    } else if (msg.type === "nack") {
      const inverses = this.undoLog.get(msg.cid) || [];
      for (const inv of inverses.reverse()) {
        this.applyLocally(inv);
      }
      this.undoLog.delete(msg.cid);
    } else if (msg.type === "vertexUpdate") {
      this.updateCache(msg.id, msg.data);
      this.notifyObservers(msg.id, msg.data);
    } else if (msg.type === "vertexDeleted") {
      this.removeFromCache(msg.id);
      this.notifyObservers(msg.id, null);
    }
  }
  
  // Other methods
}
```

#### 4.2. ThinVertex

```typescript
class ThinVertex {
  constructor(private rt: ThinRepTree, readonly id: string) {}

  newChild(props = {}) {
    const childId = uuid();
    this.rt.commit({
      type: "createVertex",
      parentId: this.id,
      id: childId,
      properties: props
    });
      
    return new ThinVertex(this.rt, childId);
  }

  set(prop: string, val: any) {
    this.rt.commit({
      type: "setProperty",
      vertexId: this.id,
      key: prop,
      value: val
    });
    return this;
  }

  get(prop: string) { 
    return this.rt.getFromCache(this.id)?.props[prop]; 
  }
  
  // Other methods
}
```

#### 4.3. Typed Proxy Objects with Zod

```typescript
function bind<T>(schema: z.ZodType<T>, vertex: ThinVertex): T {
  return new Proxy({} as T, {
    get(_, k) { 
      return vertex.get(k as string); 
    },
    set(_, k, v) {
      schema.shape[k as string]?.parse(v);  // Type check
      vertex.set(k as string, v);
      return true;
    }
  });
}

// Usage
const PersonSchema = z.object({
  name: z.string(),
  age: z.number().int()
});
type Person = z.infer<typeof PersonSchema>;

const bob = bind<Person>(PersonSchema, root.newChild());
bob.name = "Bob";  // Type-checked, optimistic update
console.log(bob.name);  // "Bob" (from cache)
```

---

### 5. Synchronization Protocol

The Rust core handles all peer-to-peer synchronization internally using state vectors, while providing a simple API to the JavaScript layer:

```typescript
// In JavaScript - simplified API for peer sync
function syncWithPeer(peerId: string, transport: "websocket" | "webrtc" | "custom") {
  // Simply tell the Rust core to sync with this peer
  this.bridge.post({ 
    type: "syncWithPeer", 
    peerId, 
    transport 
  });
  
  // The Rust core handles all the state vector exchange and op transfer
}
```

In the Rust core, state vectors are used for efficient operation transfer:

```rust
// In Rust - internal state vector handling
impl RepTree {
    // This is used internally by the Rust core for P2P sync
    fn get_missing_ops(&self, their_state: &StateVector) -> Vec<VertexOperation> {
        let missing_ranges = self.state_vector.diff(their_state);
        
        // Efficiently retrieve only the operations in the missing ranges
        let mut missing_ops = Vec::new();
        for range in missing_ranges {
            let ops = self.move_log.scan_range(ScanOptions {
                peer_id: Some(range.peer_id.clone()),
                from_seq: Some(range.start),
                to_seq: Some(range.end),
                ..Default::default()
            }).collect::<Vec<_>>();
            
            missing_ops.extend(ops);
        }
        
        // Sort by causal order
        missing_ops.sort_by(|a, b| a.id.cmp(&b.id));
        missing_ops
    }
}
```

---

### 6. Performance Features

* **LRU Cache**: Default 50,000 vertices (~4 MB) in both JS and Rust layers
* **Batch Processing**: Snapshot flush in 1,000-op chunks for efficient I/O
* **Seek-Pagination**: Efficient handling of large sibling lists
* **Optimistic Updates**: Immediate UI feedback with automatic rollback
* **Subscription Model**: Only transfer data for vertices the UI is actually using

---

### 7. Storage Implementation

#### 7.1. SQLite Adapter (Default)

```rust
pub struct SqliteVertexStore {
    conn: rusqlite::Connection,
}

impl VertexStore for SqliteVertexStore {
    async fn get_vertex(&self, id: &str) -> Result<Option<EncodedVertex>> {
        // Query: SELECT * FROM rt_vertices WHERE id = ?
    }
    
    async fn put_vertex(&self, vertex: EncodedVertex) -> Result<()> {
        // Query: INSERT OR REPLACE INTO rt_vertices VALUES (...)
    }
    
    async fn get_children_page(&self, parent_id: &str, after: Option<i64>, limit: u32) 
        -> Result<Vec<(String, i64)>> {
        // Query: SELECT id, idx FROM rt_vertices 
        //        WHERE parent_id = ? AND (? IS NULL OR idx > ?) 
        //        ORDER BY idx LIMIT ?
    }
}
```

#### 7.2. IndexedDB Adapter (Browser)

```typescript
// JavaScript side of the IndexedDB adapter
class IndexedDBStore {
  constructor(dbName: string) {
    // Initialize IndexedDB
  }
  
  async getVertex(id: string): Promise<EncodedVertex | null> {
    // IndexedDB get operation
  }
  
  async putVertex(vertex: EncodedVertex): Promise<void> {
    // IndexedDB put operation
  }
  
  async getChildrenPage(parentId: string, afterIdx: number | null, limit: number): 
    Promise<Array<{id: string, idx: number}>> {
    // IndexedDB query with cursor
  }
}
```

---

### 8. Migration Path

1. **Phase 0** – Rust core + WASM worker + SQLite backend, basic thin API
   - Core RepTree implementation in Rust
   - Basic WebAssembly bindings
   - In-memory and SQLite storage adapters

2. **Phase 1** – Zod proxies, live subscriptions, optimistic undo
   - Typed proxy objects with Zod validation
   - Subscription-based vertex updates
   - Optimistic update system with undo log

3. **Phase 2** – Native plugin (Tauri/Node), RocksDB/IndexedDB adapters
   - Tauri plugin for desktop integration
   - Node.js N-API bindings
   - Additional storage adapters (RocksDB, IndexedDB)

4. **Phase 3** – Dev-tools inspector, data migration utilities
   - Developer tools for debugging
   - Migration utilities for existing RepTree data
   - Performance optimization and benchmarking

---

### 9. Benefits

1. **Performance**: Rust implementation provides significant speed improvements for CRDT operations
2. **Memory Efficiency**: Reduced JavaScript heap usage with only a thin cache in the JS thread
3. **Scalability**: Native storage adapters enable handling millions of vertices efficiently
4. **Developer Experience**: 
   - Synchronous API with typed proxies provides excellent ergonomics
   - High-level intent-based operations are more intuitive than low-level CRDT ops
   - Direct vertex state access simplifies the mental model
5. **Cross-Platform**: Works in browsers (via WebAssembly) and desktop (via Tauri)
6. **Robustness**: Rust's strong type system and memory safety guarantees improve reliability
7. **Optimistic UI**: Immediate feedback with automatic rollback on validation failures
8. **CRDT Consistency**: Single implementation of CRDT logic in Rust ensures correctness
9. **Simplified Architecture**: Clear separation between UI layer and CRDT mechanics

---

### 10. Challenges and Mitigations

1. **Challenge**: Complexity of cross-language development
   **Mitigation**: Well-defined message protocol and comprehensive test suite

2. **Challenge**: Performance overhead of serialization
   **Mitigation**: Efficient binary serialization format and batched updates

3. **Challenge**: Debugging across language boundaries
   **Mitigation**: Detailed logging and diagnostic tools in both environments

4. **Challenge**: Learning curve for Rust development
   **Mitigation**: Gradual migration with well-documented examples and patterns
