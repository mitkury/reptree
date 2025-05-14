//! Core types for the RepTree CRDT implementation

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;
// These imports will be needed later for Yjs integration
// use uuid::Uuid;
// use yrs::Doc as YDoc;

/// Result type for RepTree operations
pub type Result<T> = std::result::Result<T, Error>;

/// Unique identifier for a vertex in the tree
pub type VertexId = String;

/// Error types for RepTree operations
#[derive(Error, Debug)]
pub enum Error {
    #[error("Vertex not found: {0}")]
    VertexNotFound(VertexId),
    
    #[error("Storage error: {0}")]
    Storage(#[from] StorageError),
    
    #[error("Invalid operation: {0}")]
    InvalidOperation(String),
    
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

/// Storage-related errors
#[derive(Error, Debug)]
pub enum StorageError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

/// Unique identifier for an operation
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct OpId {
    /// The peer that created this operation
    pub peer_id: String,
    
    /// The counter value for this operation
    pub counter: u64,
}

impl OpId {
    /// Create a new operation ID
    pub fn new(peer_id: String, counter: u64) -> Self {
        Self { peer_id, counter }
    }
    
    /// Compare two operation IDs for ordering
    pub fn compare(a: &Self, b: &Self) -> std::cmp::Ordering {
        match a.counter.cmp(&b.counter) {
            std::cmp::Ordering::Equal => a.peer_id.cmp(&b.peer_id),
            other => other,
        }
    }
}

/// Types of vertex properties
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VertexPropertyType {
    /// String value
    String(String),
    
    /// Boolean value
    Boolean(bool),
    
    /// Number value
    Number(f64),
    
    /// Integer value
    Integer(i64),
    
    /// Null value
    Null,
    
    /// Array of values
    Array(Vec<VertexPropertyType>),
    
    /// Object (map of string keys to values)
    Object(HashMap<String, VertexPropertyType>),
    
    /// Yjs document for collaborative editing
    YDoc(Vec<u8>), // Serialized Yjs document
}

/// Operation to move a vertex in the tree
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveVertex {
    /// Unique identifier for this operation
    pub id: OpId,
    
    /// The vertex being moved
    pub target_id: VertexId,
    
    /// The new parent for the vertex (null for root)
    pub parent_id: Option<VertexId>,
    
    /// Timestamp for conflict resolution
    pub timestamp: u64,
}

/// Operation to set a property on a vertex
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetVertexProperty {
    /// Unique identifier for this operation
    pub id: OpId,
    
    /// The vertex being modified
    pub target_id: VertexId,
    
    /// The property key
    pub key: String,
    
    /// The property value
    pub value: VertexPropertyType,
    
    /// Whether this property is transient (not persisted)
    pub transient: bool,
}

/// Operation to modify a CRDT property (like Yjs doc)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModifyVertexProperty {
    /// Unique identifier for this operation
    pub id: OpId,
    
    /// The vertex being modified
    pub target_id: VertexId,
    
    /// The property key
    pub key: String,
    
    /// The CRDT update data
    pub update: Vec<u8>,
}

/// Operations that can be applied to vertices
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VertexOperation {
    /// Move a vertex to a new parent
    Move(MoveVertex),
    
    /// Set a property on a vertex
    SetProperty(SetVertexProperty),
    
    /// Modify a CRDT property on a vertex
    ModifyProperty(ModifyVertexProperty),
}

/// Encoded vertex for storage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncodedVertex {
    /// Unique identifier for this vertex
    pub id: VertexId,
    
    /// Parent vertex ID (null for root)
    pub parent_id: Option<VertexId>,
    
    /// Index within parent's children
    pub idx: i64,
    
    /// Properties of this vertex
    pub properties: HashMap<String, VertexPropertyType>,
}

/// Range for state vector
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Range {
    /// The peer ID for this range
    pub peer_id: String,
    
    /// The start counter (inclusive)
    pub start: u64,
    
    /// The end counter (inclusive)
    pub end: u64,
}

/// Options for scanning a log store
#[derive(Debug, Clone)]
pub struct ScanOptions {
    /// Filter by peer ID
    pub peer_id: Option<String>,
    
    /// Start from this sequence number (inclusive)
    pub from_seq: Option<u64>,
    
    /// End at this sequence number (inclusive)
    pub to_seq: Option<u64>,
    
    /// Maximum number of results to return
    pub limit: Option<u64>,
    
    /// Scan in reverse order
    pub reverse: bool,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            peer_id: None,
            from_seq: None,
            to_seq: None,
            limit: None,
            reverse: false,
        }
    }
}
