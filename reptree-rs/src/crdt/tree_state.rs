//! Tree state implementation for RepTree
//!
//! This module provides the tree state implementation for tracking the current
//! state of the tree.

use crate::types::{EncodedVertex, MoveVertex, VertexId, VertexPropertyType};
use std::collections::{HashMap, HashSet};

/// Tree state for tracking the current state of the tree
pub struct TreeState {
    /// Map of vertex ID to vertex
    vertices: HashMap<VertexId, EncodedVertex>,
    
    /// Set of dirty vertices that need to be persisted
    dirty: HashSet<VertexId>,
}

impl TreeState {
    /// Create a new empty tree state
    pub fn new() -> Self {
        Self {
            vertices: HashMap::new(),
            dirty: HashSet::new(),
        }
    }
    
    /// Get a vertex by ID
    pub fn get_vertex(&self, id: &str) -> Option<&EncodedVertex> {
        self.vertices.get(id)
    }
    
    /// Get a mutable reference to a vertex by ID
    pub fn get_vertex_mut(&mut self, id: &str) -> Option<&mut EncodedVertex> {
        self.vertices.get_mut(id)
    }
    
    /// Get all vertices
    pub fn get_all_vertices(&self) -> Vec<&EncodedVertex> {
        self.vertices.values().collect()
    }
    
    /// Get children of a vertex
    pub fn get_children(&self, parent_id: &str) -> Vec<&EncodedVertex> {
        self.vertices
            .values()
            .filter(|v| v.parent_id.as_deref() == Some(parent_id))
            .collect()
    }
    
    /// Apply a move operation to the tree state
    pub fn apply_move(&mut self, op: &MoveVertex) {
        // First, calculate the new index if needed
        let new_idx = if let Some(parent_id) = &op.parent_id {
            // Get the highest index among siblings
            let max_idx = self.vertices
                .values()
                .filter(|v| v.parent_id.as_deref() == Some(parent_id))
                .map(|v| v.idx)
                .max()
                .unwrap_or(0);
            
            max_idx + 1
        } else {
            // Root vertices have index 0
            0
        };
        
        // Now update or create the vertex
        if let Some(vertex) = self.vertices.get_mut(&op.target_id) {
            // Update the parent ID
            vertex.parent_id = op.parent_id.clone();
            vertex.idx = new_idx;
        } else {
            // Create a new vertex
            let vertex = EncodedVertex {
                id: op.target_id.clone(),
                parent_id: op.parent_id.clone(),
                idx: new_idx,
                properties: HashMap::new(),
            };
            
            self.vertices.insert(op.target_id.clone(), vertex);
        }
        
        // Mark the vertex as dirty
        self.dirty.insert(op.target_id.clone());
    }
    
    /// Apply a batch of move operations
    pub fn apply_moves(&mut self, ops: &[MoveVertex]) {
        for op in ops {
            self.apply_move(op);
        }
    }
    
    /// Set a property on a vertex
    pub fn set_property(&mut self, vertex_id: &str, key: &str, value: VertexPropertyType) -> bool {
        if let Some(vertex) = self.vertices.get_mut(vertex_id) {
            vertex.properties.insert(key.to_string(), value);
            self.dirty.insert(vertex_id.to_string());
            true
        } else {
            false
        }
    }
    
    /// Get the dirty vertices that need to be persisted
    pub fn dirty(&self) -> Vec<&EncodedVertex> {
        self.dirty
            .iter()
            .filter_map(|id| self.vertices.get(id))
            .collect()
    }
    
    /// Clear the dirty set
    pub fn clear_dirty(&mut self) {
        self.dirty.clear();
    }
    
    /// Get the number of vertices in the tree
    pub fn len(&self) -> usize {
        self.vertices.len()
    }
    
    /// Check if the tree is empty
    pub fn is_empty(&self) -> bool {
        self.vertices.is_empty()
    }
}
