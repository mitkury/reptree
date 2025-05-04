import { describe, test, expect } from 'vitest';
import { RepTree } from '../dist/index.js';

// Helper for random operations - same as in fuzzy.test.ts
function executeRandomAction(tree: RepTree): void {
  const vertices = tree.getAllVertices();
  const vertexCount = vertices.length;
  
  // If there's only the root, always create a child
  if (vertexCount <= 1) {
    tree.newVertex(tree.rootVertexId);
    return;
  }
  
  // Random action: 0 = create, 1 = move, 2 = set property
  const actionType = Math.floor(Math.random() * 3);
  
  switch (actionType) {
    case 0: { // Create vertex
      const parentIndex = Math.floor(Math.random() * vertexCount);
      const parent = vertices[parentIndex];
      tree.newVertex(parent.id);
      break;
    }
    case 1: { // Move vertex
      // Don't move the root
      if (vertexCount <= 2) {
        tree.newVertex(tree.rootVertexId);
        return;
      }
      
      // Select a random vertex that's not the root
      let vertexIndex;
      do {
        vertexIndex = Math.floor(Math.random() * vertexCount);
      } while (vertices[vertexIndex].id === tree.rootVertexId);
      
      // Select a random parent that's not the vertex itself
      let parentIndex;
      do {
        parentIndex = Math.floor(Math.random() * vertexCount);
      } while (parentIndex === vertexIndex);
      
      tree.moveVertex(vertices[vertexIndex].id, vertices[parentIndex].id);
      break;
    }
    case 2: { // Set property
      const vertexIndex = Math.floor(Math.random() * vertexCount);
      const vertex = vertices[vertexIndex];
      const propName = `prop_${Math.floor(Math.random() * 10)}`;
      const propValue = `value_${Math.floor(Math.random() * 100)}`;
      tree.setVertexProperty(vertex.id, propName, propValue);
      break;
    }
  }
}

// Synchronize trees using state vectors
function syncWithStateVectors(trees: RepTree[]): number {
  const treeCount = trees.length;
  let totalOpsTransferred = 0;
  
  for (let i = 0; i < treeCount; i++) {
    const sourceTree = trees[i];
    const sourceStateVector = sourceTree.getStateVector();
    
    for (let j = 0; j < treeCount; j++) {
      if (i === j) continue;
      
      const targetTree = trees[j];
      const missingOps = sourceTree.getMissingOps(targetTree.getStateVector());
      totalOpsTransferred += missingOps.length;
      targetTree.merge(missingOps);
    }
  }
  
  return totalOpsTransferred;
}

describe('RepTree State Vector Synchronization', () => {
  test('should synchronize correctly using state vectors', () => {
    console.log('Starting fuzzy test with state vectors...');
    const treesCount = 3;
    const rounds = 3;
    const actionsPerRound = 100;
    
    // Track statistics
    let totalOperations = 0;
    let totalOperationsTransferred = 0;
    
    // Create trees
    const trees: RepTree[] = [];
    for (let i = 0; i < treesCount; i++) {
      trees.push(new RepTree(`peer${i+1}`));
    }
    
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
      for (let i = 1; i < treesCount; i++) {
        expect(trees[0].compareStructure(trees[i])).toBe(true);
      }
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