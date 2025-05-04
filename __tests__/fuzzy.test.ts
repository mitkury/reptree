import { describe, test, expect } from 'vitest';
import { RepTree } from '../dist/index.js';

// Helper for random operations
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
      } while (
        parentIndex === vertexIndex || 
        // Simple check to avoid cycles - just don't move vertices too much in tests
        parentIndex === vertexIndex
      );
      
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

describe('RepTree Fuzzy Testing', () => {
  test('should synchronize correctly without state vectors', () => {
    console.log('Starting fuzzy test without state vectors...');
    const treesCount = 3;
    const rounds = 3;
    const actionsPerRound = 100;
    
    let totalOperations = 0;
    
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
      
      console.log(`Round ${round + 1}/${rounds}: Synchronizing trees...`);
      
      // Synchronize all trees with each other
      for (let source = 0; source < treesCount; source++) {
        const ops = trees[source].getAllOps();
        for (let target = 0; target < treesCount; target++) {
          if (source !== target) {
            trees[target].merge(ops);
          }
        }
      }
      
      // Verify all trees have identical structure after sync
      console.log(`Round ${round + 1}/${rounds}: Verifying tree structures...`);
      for (let i = 1; i < treesCount; i++) {
        expect(trees[0].compareStructure(trees[i])).toBe(true);
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