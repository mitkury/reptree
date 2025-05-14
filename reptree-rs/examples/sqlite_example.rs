use reptree_rs::{VertexOperation, VertexPropertyType, RepTree};
use reptree_rs::types::{MoveVertex, SetVertexProperty, OpId};
use reptree_rs::storage::StorageConfig;
use tokio;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Create a temporary SQLite database
    let db_path = "test_reptree.db";
    
    // Create a storage config with SQLite
    let config = StorageConfig::Sqlite {
        path: db_path.to_string(),
    };
    println!("SQLite storage initialized at: {}", db_path);
    
    // Create a RepTree instance
    let mut tree = RepTree::new("test-peer-1".to_string(), config).await?;
    println!("RepTree instance created with peer ID: test-peer-1");
    
    // Create a root vertex using a move operation
    let root_id = "root".to_string();
    
    // Create a move operation for the root
    let root_move = MoveVertex {
        id: OpId::new("test-peer-1".to_string(), 1),
        target_id: root_id.clone(),
        parent_id: None,
        timestamp: 1000,
    };
    
    // Apply the move operation through the public API
    tree.apply_op(VertexOperation::Move(root_move)).await?;
    println!("Added root vertex with ID: {}", root_id);
    
    // Set a property on the root vertex
    let root_prop = SetVertexProperty {
        id: OpId::new("test-peer-1".to_string(), 2),
        target_id: root_id.clone(),
        key: "name".to_string(),
        value: VertexPropertyType::String("Root".to_string()),
        transient: false,
    };
    
    // Apply the property operation
    tree.apply_op(VertexOperation::SetProperty(root_prop)).await?;
    println!("Set 'name' property on root vertex");
    
    // Create a child vertex using a move operation
    let child_id = "child-1".to_string();
    
    // Create a move operation for the child
    let child_move = MoveVertex {
        id: OpId::new("test-peer-1".to_string(), 3),
        target_id: child_id.clone(),
        parent_id: Some(root_id.clone()),
        timestamp: 2000,
    };
    
    // Apply the move operation
    tree.apply_op(VertexOperation::Move(child_move)).await?;
    println!("Added child vertex with ID: {}", child_id);
    
    // Set properties on the child vertex
    let child_name_prop = SetVertexProperty {
        id: OpId::new("test-peer-1".to_string(), 4),
        target_id: child_id.clone(),
        key: "name".to_string(),
        value: VertexPropertyType::String("Child 1".to_string()),
        transient: false,
    };
    
    let child_value_prop = SetVertexProperty {
        id: OpId::new("test-peer-1".to_string(), 5),
        target_id: child_id.clone(),
        key: "value".to_string(),
        value: VertexPropertyType::Number(42.0),
        transient: false,
    };
    
    // Apply the property operations
    tree.apply_op(VertexOperation::SetProperty(child_name_prop)).await?;
    tree.apply_op(VertexOperation::SetProperty(child_value_prop)).await?;
    println!("Set properties on child vertex");
    
    // Retrieve the root vertex
    if let Some(retrieved_root) = tree.get_vertex(&root_id).await? {
        println!("Retrieved root vertex: {:?}", retrieved_root);
    } else {
        println!("Failed to retrieve root vertex");
    }
    
    // Retrieve the child vertex
    if let Some(retrieved_child) = tree.get_vertex(&child_id).await? {
        println!("Retrieved child vertex: {:?}", retrieved_child);
        
        // Print the properties
        for (key, value) in &retrieved_child.properties {
            println!("Property {}: {:?}", key, value);
        }
    } else {
        println!("Failed to retrieve child vertex");
    }
    
    // Move the child to a different position
    let move_child = MoveVertex {
        id: OpId::new("test-peer-1".to_string(), 6),
        target_id: child_id.clone(),
        parent_id: Some(root_id.clone()),
        timestamp: 3000,
    };
    
    // Apply the move operation
    tree.apply_op(VertexOperation::Move(move_child)).await?;
    println!("Moved child vertex");
    
    // Retrieve the child vertex after move
    if let Some(moved_child) = tree.get_vertex(&child_id).await? {
        println!("Child after move: {:?}", moved_child);
    }
    
    println!("Example completed successfully!");
    
    Ok(())
}
