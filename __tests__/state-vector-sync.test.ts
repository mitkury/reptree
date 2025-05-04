import { describe, test, expect } from 'vitest';
import { 
  executeRandomAction,
  createTestTrees,
  syncWithStateVectors,
  verifyTreeStructures
} from './utils/fuzzy-test-utils';
import { RepTree } from '../dist/index.js';

describe('RepTree State Vector Synchronization', () => {
  test('should synchronize correctly using state vectors', () => {
    console.log('Starting fuzzy test with state vectors...');
    const treesCount = 3;
    const rounds = 5;
    const actionsPerRound = 500;
    
    // Track statistics
    let totalOperations = 0;
    let totalOperationsTransferred = 0;
    
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
      
      console.log(`Round ${round + 1}/${rounds}: Synchronizing with state vectors...`);
      
      // Synchronize using state vectors
      const roundOperationsTransferred = syncWithStateVectors(trees);
      totalOperationsTransferred += roundOperationsTransferred;
      
      console.log(`Round ${round + 1}/${rounds}: Verifying tree structures...`);
      
      // Verify all trees have identical structure after sync
      verifyTreeStructures(trees);
    }
    
    // Calculate efficiency
    const maxPossibleTransfers = totalOperations * (treesCount - 1) * treesCount;
    const efficiency = ((maxPossibleTransfers - totalOperationsTransferred) / maxPossibleTransfers) * 100;
    
    // Final verification
    const totalVertices = trees[0].getAllVertices().length;
    console.log(`Test complete with ${totalOperations} operations performed, resulting in ${totalVertices} vertices`);
    
    expect(totalVertices).toBeGreaterThan(1);
    
    // Verify all trees have identical vertex counts
    const referenceVertexCount = trees[0].getAllVertices().length;
    for (let i = 1; i < treesCount; i++) {
      expect(trees[i].getAllVertices().length).toBe(referenceVertexCount);
    }
    
    // Check that state vector sync is more efficient than sending all ops
    // Not a strict requirement, but a good indication that vector sync works properly
    expect(totalOperationsTransferred).toBeLessThan(maxPossibleTransfers);
    
    // Log efficiency stats (useful when running tests)
    console.log(`State Vector Sync Efficiency: ${efficiency.toFixed(2)}%`);
    console.log(`Operations created: ${totalOperations}, transferred: ${totalOperationsTransferred}`);
  });
}); 