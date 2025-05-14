//! State vector implementation for RepTree
//!
//! This module provides a range-based state vector implementation for tracking
//! which operations have been applied across peers.

use crate::types::{OpId, Range};
use std::collections::HashMap;

/// State vector for tracking applied operations
pub struct StateVector {
    /// Map of peer ID to ranges of applied operations
    ranges: HashMap<String, Vec<Range>>,
}

impl StateVector {
    /// Create a new empty state vector
    pub fn new() -> Self {
        Self {
            ranges: HashMap::new(),
        }
    }
    
    /// Create a state vector from a map of ranges
    pub fn from_ranges(ranges: HashMap<String, Vec<Range>>) -> Self {
        Self { ranges }
    }
    
    /// Add an operation to the state vector
    pub fn add(&mut self, peer_id: &str, counter: u64) {
        let ranges = self.ranges.entry(peer_id.to_string()).or_insert_with(Vec::new);
        
        // Find if we can extend an existing range
        let mut extended = false;
        for range in ranges.iter_mut() {
            // If the counter is adjacent to the end of the range, extend it
            if range.end + 1 == counter {
                range.end = counter;
                extended = true;
                break;
            }
            // If the counter is adjacent to the start of the range, extend it
            else if counter + 1 == range.start {
                range.start = counter;
                extended = true;
                break;
            }
            // If the counter is already in the range, do nothing
            else if counter >= range.start && counter <= range.end {
                extended = true;
                break;
            }
        }
        
        // If we couldn't extend an existing range, create a new one
        if !extended {
            ranges.push(Range {
                peer_id: peer_id.to_string(),
                start: counter,
                end: counter,
            });
        }
        
        // Sort and merge overlapping ranges
        self.normalize_ranges(peer_id);
    }
    
    /// Sort and merge overlapping ranges for a peer
    fn normalize_ranges(&mut self, peer_id: &str) {
        if let Some(ranges) = self.ranges.get_mut(peer_id) {
            // Sort ranges by start
            ranges.sort_by_key(|r| r.start);
            
            // Merge overlapping ranges
            let mut i = 0;
            while i < ranges.len() - 1 {
                let current = &ranges[i];
                let next = &ranges[i + 1];
                
                // If the ranges overlap or are adjacent, merge them
                if current.end + 1 >= next.start {
                    let merged = Range {
                        peer_id: peer_id.to_string(),
                        start: current.start,
                        end: std::cmp::max(current.end, next.end),
                    };
                    
                    ranges[i] = merged;
                    ranges.remove(i + 1);
                } else {
                    i += 1;
                }
            }
        }
    }
    
    /// Get the ranges for all peers
    pub fn get_ranges(&self) -> HashMap<String, Vec<Range>> {
        self.ranges.clone()
    }
    
    /// Calculate the difference between this state vector and another
    pub fn diff(&self, other: &Self) -> Vec<Range> {
        let mut result = Vec::new();
        
        // For each peer in our state vector
        for (peer_id, our_ranges) in &self.ranges {
            // Get the ranges for this peer in the other state vector
            let their_ranges = other.ranges.get(peer_id).unwrap_or(&Vec::new());
            
            // Calculate the ranges we have that they don't
            for our_range in our_ranges {
                let mut remaining = vec![our_range.clone()];
                
                for their_range in their_ranges {
                    let mut new_remaining = Vec::new();
                    
                    for range in remaining {
                        // If the range is completely before their range, keep it
                        if range.end < their_range.start {
                            new_remaining.push(range);
                        }
                        // If the range is completely after their range, keep it
                        else if range.start > their_range.end {
                            new_remaining.push(range);
                        }
                        // If the range overlaps with their range, split it
                        else {
                            // If there's a part before their range, keep it
                            if range.start < their_range.start {
                                new_remaining.push(Range {
                                    peer_id: peer_id.clone(),
                                    start: range.start,
                                    end: their_range.start - 1,
                                });
                            }
                            
                            // If there's a part after their range, keep it
                            if range.end > their_range.end {
                                new_remaining.push(Range {
                                    peer_id: peer_id.clone(),
                                    start: their_range.end + 1,
                                    end: range.end,
                                });
                            }
                        }
                    }
                    
                    remaining = new_remaining;
                }
                
                // Add the remaining ranges to the result
                result.extend(remaining);
            }
        }
        
        result
    }
}
