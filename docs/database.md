# RepTree as a Database

## Data Orientation and Model

RepTree is an in-memory, JavaScript runtime, hierarchical, tree-structured, distributed database with the following characteristics:

- **In-Memory Operation**: All data and operations are held in memory
- **JavaScript Runtime**: Runs in JavaScript/TypeScript environments (browser, Node.js, Bun, Deno)
- **Tree-Based Data Model**: Organizes data in a parent-child hierarchy of nodes
- **Property System**: Each node contains key-value properties
- **Dual Property Types**: Supports both persistent and transient properties
- **Node Relocation**: Nodes can be moved within the tree while maintaining consistency
- **Strong Eventual Consistency**: All replicas eventually converge to identical states

## CRDT Foundation

RepTree employs a multi-CRDT architecture for distributed operation:

- **Move Tree CRDT**: Handles structural operations (based on [Kleppmann's paper](https://martin.kleppmann.com/papers/move-op.pdf))
- **Last-Writer-Wins (LWW) CRDT**: Manages property values with simple conflict resolution
// Yjs integration is not included in this branch. See `docs/yjs.md`.

## Operation-Based Storage

- **Operation Logs**: Maintains ordered logs of operations rather than just state
- **Move Operations**: Track structural changes to the tree
- **Property Operations**: Track changes to node properties
- **Causal Ordering**: Uses Lamport clocks to establish operation ordering

## Synchronization Protocol

- **Range-Based State Vectors**: Efficiently track which operations have been applied
- **Delta Synchronization**: Transmits only missing operations during peer synchronization
- **Conflict Resolution Algorithm**: Built-in algorithms for resolving concurrent edits

## Query and Access Patterns

- **Hierarchical Traversal**: Primary access method via parent-child relationships
- **Direct Node Access**: Fast lookup by node ID
- **Child Enumeration**: List and filter children of a node
- **Property Access**: Get and set properties on any node

## Performance Considerations

- **In-Memory Operation**: Core operations are in-memory for performance
- **Persistence via Snapshots**: Periodic snapshots with incremental operation logs
- **Optimized Child Storage**: Proposals for B-tree storage for nodes with many children
- **Memory Efficiency**: Transient properties for ephemeral data

## Comparison to Traditional Databases

While traditional databases focus on:
- Tables and relations (relational)
- Document collections (document-oriented)
- Arbitrary node connections (graph)

RepTree specializes in:
- Hierarchical data representation
- Built-in collaborative editing
- Peer-to-peer operation with conflict resolution
- Strong eventual consistency guarantees

## Extension Capabilities

RepTree can be extended to serve as:
- A virtual file system (with specialized node types)
- A collaborative editing platform (via Yjs integration) — see `docs/yjs.md`
- A versioned data store (via operation history)

RepTree combines aspects of tree databases, event-sourced systems, and CRDT-based collaborative editors into a specialized database paradigm optimized for hierarchical, distributed data management.