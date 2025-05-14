use reptree_rs::{
    RepTree, VertexOperation, VertexPropertyType,
    types::{MoveVertex, SetVertexProperty, OpId},
    storage::StorageConfig,
};
use tempfile::tempdir;

#[tokio::test]
async fn test_sqlite_storage() -> Result<(), Box<dyn std::error::Error>> {
    // Create a temporary directory for the SQLite database
    let temp_dir = tempdir()?;
    let db_path = temp_dir.path().join("test_reptree.db");
    
    // Create a storage config with SQLite
    let config = StorageConfig::Sqlite {
        path: db_path.to_string_lossy().to_string(),
    };
    
    // Create a RepTree instance
    let mut tree = RepTree::new("test-peer-1".to_string(), config).await?;
    
    // Create a root vertex
    let root_id = "root".to_string();
    let root_move = MoveVertex {
        id: OpId::new("test-peer-1".to_string(), 1),
        target_id: root_id.clone(),
        parent_id: None,
        timestamp: 1000,
    };
    
    // Apply the move operation
    let result = tree.apply_op(VertexOperation::Move(root_move)).await?;
    assert_eq!(result.peer_id, "test-peer-1");
    assert_eq!(result.counter, 1);
    
    // Set a property on the root vertex
    let root_prop = SetVertexProperty {
        id: OpId::new("test-peer-1".to_string(), 2),
        target_id: root_id.clone(),
        key: "name".to_string(),
        value: VertexPropertyType::String("Root".to_string()),
        transient: false,
    };
    
    // Apply the property operation
    let result = tree.apply_op(VertexOperation::SetProperty(root_prop)).await?;
    assert_eq!(result.peer_id, "test-peer-1");
    assert_eq!(result.counter, 2);
    
    // Create a child vertex
    let child_id = "child-1".to_string();
    let child_move = MoveVertex {
        id: OpId::new("test-peer-1".to_string(), 3),
        target_id: child_id.clone(),
        parent_id: Some(root_id.clone()),
        timestamp: 2000,
    };
    
    // Apply the move operation
    let result = tree.apply_op(VertexOperation::Move(child_move)).await?;
    assert_eq!(result.peer_id, "test-peer-1");
    assert_eq!(result.counter, 3);
    
    // Retrieve the root vertex
    let root = tree.get_vertex(&root_id).await?.unwrap();
    assert_eq!(root.id, root_id);
    assert_eq!(root.parent_id, None);
    assert!(root.properties.contains_key("name"));
    
    if let VertexPropertyType::String(name) = &root.properties["name"] {
        assert_eq!(name, "Root");
    } else {
        panic!("Expected String property");
    }
    
    // Retrieve the child vertex
    let child = tree.get_vertex(&child_id).await?.unwrap();
    assert_eq!(child.id, child_id);
    assert_eq!(child.parent_id, Some(root_id.clone()));
    
    // Create a new RepTree instance with the same storage to test persistence
    let config2 = StorageConfig::Sqlite {
        path: db_path.to_string_lossy().to_string(),
    };
    
    let tree2 = RepTree::new("test-peer-2".to_string(), config2).await?;
    
    // Verify that the vertices are still there
    let root2 = tree2.get_vertex(&root_id).await?.unwrap();
    assert_eq!(root2.id, root_id);
    assert_eq!(root2.parent_id, None);
    
    let child2 = tree2.get_vertex(&child_id).await?.unwrap();
    assert_eq!(child2.id, child_id);
    assert_eq!(child2.parent_id, Some(root_id));
    
    Ok(())
}
