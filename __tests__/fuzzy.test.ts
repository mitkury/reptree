import { describe, test, expect } from 'vitest';
import { 
  executeRandomAction,
  createTestTrees,
  syncWithAllOps,
  verifyTreeStructures
} from './utils/fuzzy-test-utils';
import { type VertexOperation } from '../src/operations';

// Helper function to shuffle an array in-place
function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

describe('RepTree Fuzzy Testing', () => {
  test('should synchronize correctly without state vectors', () => {
    console.log('Starting fuzzy test without state vectors...');
    const treesCount = 3;
    const rounds = 5;
    const actionsPerRound = 500;
    
    let totalOperations = 0;
    
    // Create trees
    const trees = createTestTrees(treesCount);
    
    // Run multiple rounds of operations and sync
    for (let round = 0; round < rounds; round++) {
      console.log(`Round ${round + 1}/${rounds}: Executing random operations...`);
      
      // Each tree performs random operations
      for (let treeIndex = 0; treeIndex < treesCount; treeIndex++) {
        for (let i = 0; i < actionsPerRound; i++) {
          executeRandomAction(trees[treeIndex]);
          totalOperations++;
        }
      }
      
      console.log(`Round ${round + 1}/${rounds}: Synchronizing trees...`);
      
      // Synchronize all trees with each other using the utility function
      syncWithAllOps(trees);
      
      // Verify all trees have identical structure after sync
      console.log(`Round ${round + 1}/${rounds}: Verifying tree structures...`);
      verifyTreeStructures(trees);
    }
    
    // Final verification
    const totalVertices = trees[0].getAllVertices().length;
    console.log(`Test complete with ${totalOperations} operations performed, resulting in ${totalVertices} vertices`);
    
    expect(totalVertices).toBeGreaterThan(1);
    
    // Verify all trees have identical vertex counts
    const referenceVertexCount = trees[0].getAllVertices().length;
    for (let i = 1; i < treesCount; i++) {
      expect(trees[i].getAllVertices().length).toBe(referenceVertexCount);
    }
  });

  /**
   * This test intentionally shuffles operations before merging to test 
   * how the CRDT system handles out-of-order operations.
   * 
   * KNOWN ISSUE: RepTree's current implementation may not properly handle 
   * completely randomized operation ordering since operations often have
   * causal dependencies (e.g., you need to create a vertex before moving it).
   * 
   * If this test fails, it's documenting a known limitation rather than a bug.
   * In real-world scenarios, operation delivery often preserves some causal ordering.
   */
  test('causal dependency test: should handle out-of-order operations with shuffled merges', () => {
    console.log('Starting fuzzy test with shuffled operations...');
    const treesCount = 3;
    const rounds = 5;
    const actionsPerRound = 500;
    
    let totalOperations = 0;
    
    // Create trees
    const trees = createTestTrees(treesCount);
    
    // Run multiple rounds of operations and sync
    for (let round = 0; round < rounds; round++) {
      console.log(`Round ${round + 1}/${rounds}: Executing random operations...`);
      
      // Each tree performs random operations
      for (let treeIndex = 0; treeIndex < treesCount; treeIndex++) {
        for (let i = 0; i < actionsPerRound; i++) {
          executeRandomAction(trees[treeIndex]);
          totalOperations++;
        }
      }
      
      console.log(`Round ${round + 1}/${rounds}: Shuffling and synchronizing trees...`);
      
      try {
        // Synchronize with shuffled operations
        for (let i = 0; i < treesCount; i++) {
          const sourceTree = trees[i];
          // Create a mutable copy of the operations array that we can shuffle
          const ops = [...sourceTree.getAllOps()];
          
          for (let j = 0; j < treesCount; j++) {
            if (i !== j) {
              // Shuffle operations before merging to test out-of-order behavior
              const shuffledOps = shuffleArray(ops);
              trees[j].merge(shuffledOps);
            }
          }
        }
        
        // Verify all trees have identical structure after shuffled sync
        console.log(`Round ${round + 1}/${rounds}: Verifying tree structures after shuffled sync...`);
        verifyTreeStructures(trees);
      } catch (error) {
        console.error(`Test failed in round ${round + 1}:`, error);
        
        // Print additional diagnostics
        for (let i = 0; i < treesCount; i++) {
          console.log(`Tree ${i+1} vertex count: ${trees[i].getAllVertices().length}`);
        }
        
        throw error;
      }
    }
    
    // Final verification
    const totalVertices = trees[0].getAllVertices().length;
    console.log(`Test complete with ${totalOperations} operations performed, resulting in ${totalVertices} vertices`);
    
    expect(totalVertices).toBeGreaterThan(1);
    
    // Verify all trees have identical vertex counts
    const referenceVertexCount = trees[0].getAllVertices().length;
    for (let i = 1; i < treesCount; i++) {
      expect(trees[i].getAllVertices().length).toBe(referenceVertexCount);
    }
  });
  
  /**
   * This test simulates a more realistic network scenario where operations from
   * the same peer arrive in order (preserving causal dependencies within a peer),
   * but operations between different peers can be interleaved in any order.
   */
  test('should handle interleaved operations from different peers', () => {
    console.log('Starting fuzzy test with interleaved peer operations...');
    const treesCount = 5;
    const rounds = 5;
    const actionsPerRound = 500;
    
    let totalOperations = 0;
    
    // Create trees
    const trees = createTestTrees(treesCount);
    
    // Run multiple rounds of operations and sync
    for (let round = 0; round < rounds; round++) {
      console.log(`Round ${round + 1}/${rounds}: Executing random operations...`);
      
      // Each tree performs random operations
      for (let treeIndex = 0; treeIndex < treesCount; treeIndex++) {
        for (let i = 0; i < actionsPerRound; i++) {
          executeRandomAction(trees[treeIndex]);
          totalOperations++;
        }
      }
      
      console.log(`Round ${round + 1}/${rounds}: Interleaving operations between peers...`);
      
      // Group operations by peer ID and maintain causal ordering within each peer
      try {
        // For each target tree
        for (let targetIndex = 0; targetIndex < treesCount; targetIndex++) {
          const targetTree = trees[targetIndex];
          
          // Collect operations from all other peers
          const peerOps: Array<VertexOperation[]> = [];
          for (let sourceIndex = 0; sourceIndex < treesCount; sourceIndex++) {
            if (sourceIndex !== targetIndex) {
              // Get all ops from this source
              const sourceTree = trees[sourceIndex];
              const ops = [...sourceTree.getAllOps()];
              peerOps.push(ops);
            }
          }
          
          // Interleave operations from different peers
          // This maintains causal order within each peer but randomizes between peers
          const allInterleaved: VertexOperation[] = [];
          
          // While any peer still has operations
          while (peerOps.some(ops => ops.length > 0)) {
            // Randomly select a peer that still has operations
            const availablePeers = peerOps.filter(ops => ops.length > 0);
            if (availablePeers.length === 0) break;
            
            const randomPeerIndex = Math.floor(Math.random() * availablePeers.length);
            const selectedPeerOps = availablePeers[randomPeerIndex];
            
            // Take the next operation from this peer (preserving causal order)
            const nextOp = selectedPeerOps.shift();
            if (nextOp) allInterleaved.push(nextOp);
          }
          
          // Apply the interleaved operations to the target tree
          targetTree.merge(allInterleaved);
        }
        
        // Verify all trees have identical structure after interleaved sync
        console.log(`Round ${round + 1}/${rounds}: Verifying tree structures after interleaved sync...`);
        verifyTreeStructures(trees);
      } catch (error) {
        console.error(`Test failed in round ${round + 1}:`, error);
        
        // Print additional diagnostics
        for (let i = 0; i < treesCount; i++) {
          console.log(`Tree ${i+1} vertex count: ${trees[i].getAllVertices().length}`);
        }
        
        throw error;
      }
    }
    
    // Final verification
    const totalVertices = trees[0].getAllVertices().length;
    console.log(`Test complete with ${totalOperations} operations performed, resulting in ${totalVertices} vertices`);
    
    expect(totalVertices).toBeGreaterThan(1);
    
    // Verify all trees have identical vertex counts
    const referenceVertexCount = trees[0].getAllVertices().length;
    for (let i = 1; i < treesCount; i++) {
      expect(trees[i].getAllVertices().length).toBe(referenceVertexCount);
    }
  });
}); 