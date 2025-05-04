import { describe, test, expect } from 'vitest';
import { 
  executeRandomAction,
  createTestTrees,
  syncWithAllOps,
  verifyTreeStructures
} from './utils/fuzzy-test-utils';

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
}); 