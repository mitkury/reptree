# RepTree Rust Implementation

A Rust implementation of the RepTree CRDT for tree data structures with SQLite storage support.

## Overview

RepTree is a tree data structure using CRDTs (Conflict-free Replicated Data Types) for seamless replication between peers. This Rust implementation provides:

- Core CRDT functionality for tree operations
- SQLite storage backend for persistence
- State vector implementation for efficient synchronization
- Support for vertex properties and operations

## Features

- **CRDT Operations**: Create, move, and modify vertices in a tree structure
- **SQLite Storage**: Persist tree data in SQLite databases
- **State Vector**: Track applied operations across peers for efficient synchronization
- **Vertex Properties**: Support for different property types (String, Number, Boolean, etc.)

## Usage

Here's a basic example of using RepTree with SQLite storage:

```rust
use reptree_rs::{VertexOperation, VertexPropertyType, RepTree};
use reptree_rs::types::{MoveVertex, SetVertexProperty, OpId};
use reptree_rs::storage::StorageConfig;
use tokio;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Create a SQLite database
    let db_path = "reptree.db";
    
    // Create a storage config with SQLite
    let config = StorageConfig::Sqlite {
        path: db_path.to_string(),
    };
    
    // Create a RepTree instance
    let mut tree = RepTree::new("peer-1".to_string(), config).await?;
    
    // Create a root vertex
    let root_id = "root".to_string();
    let root_move = MoveVertex {
        id: OpId::new("peer-1".to_string(), 1),
        target_id: root_id.clone(),
        parent_id: None,
        timestamp: 1000,
    };
    
    // Apply the move operation
    tree.apply_op(VertexOperation::Move(root_move)).await?;
    
    // Set a property on the root vertex
    let root_prop = SetVertexProperty {
        id: OpId::new("peer-1".to_string(), 2),
        target_id: root_id.clone(),
        key: "name".to_string(),
        value: VertexPropertyType::String("Root".to_string()),
        transient: false,
    };
    
    // Apply the property operation
    tree.apply_op(VertexOperation::SetProperty(root_prop)).await?;
    
    // Retrieve the root vertex
    if let Some(root) = tree.get_vertex(&root_id).await? {
        println!("Root vertex: {:?}", root);
    }
    
    Ok(())
}
```

## Architecture

The RepTree Rust implementation consists of several key components:

1. **RepTree**: The main entry point for the library, providing methods for applying operations and managing the tree state.
2. **Storage**: Adapters for persisting RepTree data, with SQLite as the primary implementation.
3. **State Vector**: A range-based state vector implementation for tracking applied operations across peers.
4. **Types**: Core types used in the RepTree implementation, including vertex properties and operations.

## Development

To build and test the library:

```bash
# Build the library
cargo build

# Run tests
cargo test

# Run the example
cargo run --example sqlite_example
```

## License

MIT
