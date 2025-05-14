//! Storage implementations for RepTree
//! 
//! This module provides storage adapters for persisting RepTree data.

mod sqlite;

pub use self::sqlite::SqliteStorage;
use crate::types::{EncodedVertex, MoveVertex, Result, ScanOptions, SetVertexProperty, VertexId};
use async_trait::async_trait;
use futures::stream::BoxStream;

/// Storage configuration options
#[derive(Debug, Clone)]
pub enum StorageConfig {
    /// In-memory storage (for testing)
    Memory,
    
    /// SQLite storage
    Sqlite {
        /// Path to the SQLite database file
        path: String,
    },
}

/// Interface for vertex storage
#[async_trait]
pub trait VertexStore: Send + Sync {
    /// Get a vertex by ID
    async fn get_vertex(&self, id: &str) -> Result<Option<EncodedVertex>>;
    
    /// Store a vertex
    async fn put_vertex(&self, vertex: EncodedVertex) -> Result<()>;
    
    /// Get a page of children for a parent vertex
    async fn get_children_page(
        &self,
        parent_id: &str,
        after_idx: Option<i64>,
        limit: usize,
    ) -> Result<Vec<(VertexId, i64)>>;
}

/// Interface for operation log storage
#[async_trait]
pub trait LogStore<T>: Send + Sync {
    /// Append an operation to the log
    async fn append(&self, op: T) -> Result<u64>;
    
    /// Get the latest sequence number
    async fn latest_seq(&self) -> Result<u64>;
    
    /// Scan a range of operations
    async fn scan_range(&self, opts: ScanOptions) -> BoxStream<'_, Result<T>>;
}

/// Combined storage for RepTree
pub struct Storage {
    /// Store for vertices
    pub vertices: Box<dyn VertexStore>,
    
    /// Store for move operations
    pub move_log: Box<dyn LogStore<MoveVertex>>,
    
    /// Store for property operations
    pub prop_log: Box<dyn LogStore<SetVertexProperty>>,
}

impl Storage {
    /// Create a new storage instance
    pub async fn new(config: StorageConfig) -> Result<Self> {
        match config {
            StorageConfig::Memory => {
                // For now, we'll use SQLite with an in-memory database
                let storage = SqliteStorage::new(":memory:").await?;
                Ok(Self {
                    vertices: Box::new(storage.clone()),
                    move_log: Box::new(storage.clone()),
                    prop_log: Box::new(storage),
                })
            }
            StorageConfig::Sqlite { path } => {
                let storage = SqliteStorage::new(&path).await?;
                Ok(Self {
                    vertices: Box::new(storage.clone()),
                    move_log: Box::new(storage.clone()),
                    prop_log: Box::new(storage),
                })
            }
        }
    }
}
