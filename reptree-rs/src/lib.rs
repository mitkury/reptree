//! RepTree-RS: A Rust implementation of RepTree CRDT for tree data structures
//! 
//! This crate provides a Rust implementation of the RepTree CRDT, which allows for
//! conflict-free replication of tree data structures between peers.

mod crdt;
mod storage;
mod types;

pub use crdt::RepTree;
pub use types::{Error, Result, VertexId, VertexOperation, VertexPropertyType};

#[cfg(test)]
mod tests {
    // Tests will be added as we implement the functionality
}
