import { bench, describe } from 'vitest';
import { RepTree } from '../src/RepTree';

describe('RepTree Scaling Performance', () => {
  bench('tree size scaling - 1000 vertices', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    
    // Create a tree with 1000 vertices
    for (let i = 0; i < 1000; i++) {
      tree.newVertex(root.id, { name: `vertex-${i}` });
    }
    
    // Perform a standard operation to measure performance at this scale
    tree.getAllVertices();
  });
  
  bench('tree size scaling - 5000 vertices', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    
    // Create a tree with 5000 vertices
    for (let i = 0; i < 5000; i++) {
      tree.newVertex(root.id, { name: `vertex-${i}` });
    }
    
    // Perform a standard operation to measure performance at this scale
    tree.getAllVertices();
  });

  bench('deep tree traversal', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    
    // Create a deep tree (chain of vertices)
    let currentParentId = root.id;
    for (let i = 0; i < 100; i++) {
      const vertex = tree.newVertex(currentParentId, { depth: i });
      currentParentId = vertex.id;
    }
    
    // Benchmark traversal of the deep tree
    tree.getAncestors(currentParentId);
  });

  bench('wide tree traversal', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    
    // Create a wide tree (many children at one level)
    for (let i = 0; i < 1000; i++) {
      tree.newVertex(root.id, { index: i });
    }
    
    // Benchmark getting all children
    tree.getChildren(root.id);
  });
});
