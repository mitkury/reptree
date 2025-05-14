//! CRDT implementation for RepTree
//! 
//! This module provides the core CRDT functionality for RepTree.

mod state_vector;
mod tree_state;

pub use state_vector::StateVector;
// pub use tree_state::TreeState;

use crate::storage::{Storage, StorageConfig};
use crate::types::{
    EncodedVertex, Error, MoveVertex, OpId, Range, Result, ScanOptions, SetVertexProperty,
    VertexId, VertexOperation, VertexPropertyType,
};
use futures::StreamExt;
use lru::LruCache;
use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

/// RepTree CRDT implementation
pub struct RepTree {
    /// Peer ID for this instance
    peer_id: String,
    
    /// Lamport clock for operation ordering
    lamport_clock: u64,
    
    /// Storage for vertices and operations
    storage: Arc<Storage>,
    
    /// In-memory cache of vertices
    vertex_cache: Mutex<LruCache<VertexId, EncodedVertex>>,
    
    /// State vector for tracking applied operations
    state_vector: Mutex<StateVector>,
    
    /// Default cache size (50,000 vertices)
    default_cache_size: usize,
}

impl RepTree {
    /// Create a new RepTree instance
    pub async fn new(peer_id: String, config: StorageConfig) -> Result<Self> {
        let storage = Arc::new(Storage::new(config).await?);
        let default_cache_size = 50_000;
        
        Ok(Self {
            peer_id,
            lamport_clock: 0,
            storage,
            vertex_cache: Mutex::new(LruCache::new(NonZeroUsize::new(default_cache_size).unwrap())),
            state_vector: Mutex::new(StateVector::new()),
            default_cache_size,
        })
    }
    
    /// Get the peer ID for this instance
    pub fn peer_id(&self) -> &str {
        &self.peer_id
    }
    
    /// Get the current lamport clock value
    pub fn lamport_clock(&self) -> u64 {
        self.lamport_clock
    }
    
    /// Update the lamport clock with a new value
    fn update_lamport_clock(&mut self, timestamp: u64) {
        self.lamport_clock = std::cmp::max(self.lamport_clock, timestamp) + 1;
    }
    
    /// Generate a new operation ID
    fn new_op_id(&mut self) -> OpId {
        let counter = self.lamport_clock;
        self.lamport_clock += 1;
        OpId::new(self.peer_id.clone(), counter)
    }
    
    /// Apply an operation to the tree
    pub async fn apply_op(&mut self, op: VertexOperation) -> Result<OpId> {
        match op {
            VertexOperation::Move(move_op) => {
                self.update_lamport_clock(move_op.timestamp);
                self.apply_move(move_op.clone()).await?;
                self.storage.move_log.append(move_op.clone()).await?;
                
                // Update state vector
                let mut state_vector = self.state_vector.lock().await;
                state_vector.add(&move_op.id.peer_id, move_op.id.counter);
                
                Ok(move_op.id)
            }
            VertexOperation::SetProperty(prop_op) => {
                self.apply_property(prop_op.clone()).await?;
                self.storage.prop_log.append(prop_op.clone()).await?;
                
                // Update state vector
                let mut state_vector = self.state_vector.lock().await;
                state_vector.add(&prop_op.id.peer_id, prop_op.id.counter);
                
                Ok(prop_op.id)
            }
            VertexOperation::ModifyProperty(modify_op) => {
                // For now, we'll just treat this as a regular property update
                // In a full implementation, we'd handle CRDT updates differently
                let prop_op = SetVertexProperty {
                    id: modify_op.id,
                    target_id: modify_op.target_id,
                    key: modify_op.key,
                    value: VertexPropertyType::YDoc(modify_op.update),
                    transient: false,
                };
                
                self.apply_property(prop_op.clone()).await?;
                self.storage.prop_log.append(prop_op.clone()).await?;
                
                // Update state vector
                let mut state_vector = self.state_vector.lock().await;
                state_vector.add(&prop_op.id.peer_id, prop_op.id.counter);
                
                Ok(prop_op.id)
            }
        }
    }
    
    /// Apply a batch of operations
    pub async fn apply_ops(&mut self, ops: Vec<VertexOperation>) -> Result<Vec<OpId>> {
        let mut results = Vec::with_capacity(ops.len());
        
        for op in ops {
            let id = self.apply_op(op).await?;
            results.push(id);
        }
        
        Ok(results)
    }
    
    /// Apply a move operation
    async fn apply_move(&mut self, op: MoveVertex) -> Result<()> {
        // Check if the target vertex exists
        let target_exists = self.get_vertex(&op.target_id).await?.is_some();
        
        // If the parent ID is specified, check if it exists
        if let Some(parent_id) = &op.parent_id {
            let parent_exists = self.get_vertex(parent_id).await?.is_some();
            if !parent_exists {
                return Err(Error::VertexNotFound(parent_id.clone()));
            }
        }
        
        // If the target doesn't exist, create it
        if !target_exists {
            let vertex = EncodedVertex {
                id: op.target_id.clone(),
                parent_id: op.parent_id.clone(),
                idx: 0, // We'll set the correct index when we apply the move
                properties: HashMap::new(),
            };
            
            self.storage.vertices.put_vertex(vertex.clone()).await?;
            
            // Update the cache
            let mut cache = self.vertex_cache.lock().await;
            cache.put(op.target_id.clone(), vertex);
        } else {
            // Update the parent ID of the existing vertex
            let mut vertex = self.get_vertex(&op.target_id).await?
                .ok_or_else(|| Error::VertexNotFound(op.target_id.clone()))?;
            
            vertex.parent_id = op.parent_id.clone();
            
            // Get the highest index among siblings
            let siblings = if let Some(parent_id) = &op.parent_id {
                self.storage.vertices.get_children_page(parent_id, None, 1000).await?
            } else {
                Vec::new()
            };
            
            let max_idx = siblings.iter().map(|(_, idx)| *idx).max().unwrap_or(0);
            vertex.idx = max_idx + 1;
            
            self.storage.vertices.put_vertex(vertex.clone()).await?;
            
            // Update the cache
            let mut cache = self.vertex_cache.lock().await;
            cache.put(op.target_id.clone(), vertex);
        }
        
        Ok(())
    }
    
    /// Apply a property operation
    async fn apply_property(&mut self, op: SetVertexProperty) -> Result<()> {
        // Check if the target vertex exists
        let mut vertex = match self.get_vertex(&op.target_id).await? {
            Some(v) => v,
            None => return Err(Error::VertexNotFound(op.target_id.clone())),
        };
        
        // Update the property
        if op.transient {
            // Transient properties are not persisted
            // In a full implementation, we'd handle these differently
            return Ok(());
        } else {
            vertex.properties.insert(op.key.clone(), op.value.clone());
            
            self.storage.vertices.put_vertex(vertex.clone()).await?;
            
            // Update the cache
            let mut cache = self.vertex_cache.lock().await;
            cache.put(op.target_id.clone(), vertex);
        }
        
        Ok(())
    }
    
    /// Get a vertex by ID
    pub async fn get_vertex(&self, id: &str) -> Result<Option<EncodedVertex>> {
        // Check the cache first
        let mut cache = self.vertex_cache.lock().await;
        if let Some(vertex) = cache.get(id) {
            return Ok(Some(vertex.clone()));
        }
        
        // If not in cache, check storage
        let vertex = self.storage.vertices.get_vertex(id).await?;
        
        // Update the cache if found
        if let Some(vertex) = &vertex {
            cache.put(id.to_string(), vertex.clone());
        }
        
        Ok(vertex)
    }
    
    /// Get children of a vertex
    pub async fn get_children(&self, parent_id: &str) -> Result<Vec<EncodedVertex>> {
        let children_refs = self.storage.vertices.get_children_page(parent_id, None, 1000).await?;
        
        let mut children = Vec::with_capacity(children_refs.len());
        for (id, _) in children_refs {
            if let Some(vertex) = self.get_vertex(&id).await? {
                children.push(vertex);
            }
        }
        
        // Sort by index
        children.sort_by_key(|v| v.idx);
        
        Ok(children)
    }
    
    /// Create a new vertex
    pub async fn create_vertex(&mut self, parent_id: Option<String>) -> Result<VertexId> {
        let id = Uuid::new_v4().to_string();
        let op_id = self.new_op_id();
        let timestamp = self.lamport_clock;
        
        let move_op = MoveVertex {
            id: op_id,
            target_id: id.clone(),
            parent_id,
            timestamp,
        };
        
        self.apply_op(VertexOperation::Move(move_op)).await?;
        
        Ok(id)
    }
    
    /// Set a property on a vertex
    pub async fn set_property(
        &mut self,
        vertex_id: &str,
        key: &str,
        value: VertexPropertyType,
    ) -> Result<OpId> {
        let op_id = self.new_op_id();
        
        let prop_op = SetVertexProperty {
            id: op_id.clone(),
            target_id: vertex_id.to_string(),
            key: key.to_string(),
            value,
            transient: false,
        };
        
        self.apply_op(VertexOperation::SetProperty(prop_op)).await?;
        
        Ok(op_id)
    }
    
    /// Move a vertex to a new parent
    pub async fn move_vertex(&mut self, vertex_id: &str, parent_id: Option<String>) -> Result<OpId> {
        let op_id = self.new_op_id();
        let timestamp = self.lamport_clock;
        
        let move_op = MoveVertex {
            id: op_id.clone(),
            target_id: vertex_id.to_string(),
            parent_id,
            timestamp,
        };
        
        self.apply_op(VertexOperation::Move(move_op)).await?;
        
        Ok(op_id)
    }
    
    /// Get the state vector
    pub async fn get_state_vector(&self) -> HashMap<String, Vec<Range>> {
        let state_vector = self.state_vector.lock().await;
        state_vector.get_ranges()
    }
    
    /// Get operations missing from another state vector
    pub async fn get_missing_ops(&self, their_state: HashMap<String, Vec<Range>>) -> Result<Vec<VertexOperation>> {
        let our_state = self.state_vector.lock().await;
        let their_sv = StateVector::from_ranges(their_state);
        
        let missing_ranges = our_state.diff(&their_sv);
        let mut missing_ops = Vec::new();
        
        for range in missing_ranges {
            // Get move operations in this range
            let move_ops = self.storage.move_log.scan_range(ScanOptions {
                peer_id: Some(range.peer_id.clone()),
                from_seq: Some(range.start),
                to_seq: Some(range.end),
                limit: None,
                reverse: false,
            }).await;
            
            // Collect move operations
            let mut move_stream = move_ops;
            while let Some(op_result) = move_stream.next().await {
                match op_result {
                    Ok(op) => missing_ops.push(VertexOperation::Move(op)),
                    Err(_) => continue,
                }
            }
            
            // Get property operations in this range
            let prop_ops = self.storage.prop_log.scan_range(ScanOptions {
                peer_id: Some(range.peer_id.clone()),
                from_seq: Some(range.start),
                to_seq: Some(range.end),
                limit: None,
                reverse: false,
            }).await;
            
            // Collect property operations
            let mut prop_stream = prop_ops;
            while let Some(op_result) = prop_stream.next().await {
                match op_result {
                    Ok(op) => missing_ops.push(VertexOperation::SetProperty(op)),
                    Err(_) => continue,
                }
            }
        }
        
        // Sort operations by causal order
        missing_ops.sort_by(|a, b| {
            let a_id = match a {
                VertexOperation::Move(op) => &op.id,
                VertexOperation::SetProperty(op) => &op.id,
                VertexOperation::ModifyProperty(op) => &op.id,
            };
            
            let b_id = match b {
                VertexOperation::Move(op) => &op.id,
                VertexOperation::SetProperty(op) => &op.id,
                VertexOperation::ModifyProperty(op) => &op.id,
            };
            
            OpId::compare(a_id, b_id)
        });
        
        Ok(missing_ops)
    }
}
