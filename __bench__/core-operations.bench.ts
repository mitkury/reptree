import { bench, describe } from 'vitest';
import { RepTree } from '../src/RepTree';

describe('RepTree Core Operations', () => {
  bench('vertex creation', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    for (let i = 0; i < 1000; i++) {
      tree.newVertex(root.id, { name: `vertex-${i}` });
    }
  });

  bench('property access', () => {
    // Setup tree with properties
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const vertex = tree.newVertex(root.id, { name: 'test-vertex' });
    
    // Benchmark property access
    for (let i = 0; i < 10000; i++) {
      tree.getVertexProperty(vertex.id, 'name');
    }
  });

  bench('tree traversal', () => {
    // Setup tree structure
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const depth = 5;
    const breadth = 5;
    
    // Create a tree with depth and breadth
    let currentParentId = root.id;
    for (let d = 0; d < depth; d++) {
      const parentId = currentParentId;
      for (let b = 0; b < breadth; b++) {
        const vertex = tree.newVertex(parentId, { depth: d, index: b });
        if (b === 0) {
          currentParentId = vertex.id;
        }
      }
    }

    // Benchmark traversal
    for (let i = 0; i < 100; i++) {
      tree.getAncestors(currentParentId);
    }
  });
});
