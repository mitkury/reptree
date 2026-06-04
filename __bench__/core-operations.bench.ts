import { bench, describe } from 'vitest';
import { RepTree } from '../src/RepTree';

describe('RepTree Core Operations', () => {
  bench('node creation', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    for (let i = 0; i < 1000; i++) {
      tree.newNode(root.id, { name: `node-${i}` });
    }
  });

  bench('property access', () => {
    // Setup tree with properties
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const node = tree.newNode(root.id, { name: 'test-node' });

    // Benchmark property access
    for (let i = 0; i < 10000; i++) {
      tree.getNodeProperty(node.id, 'name');
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
        const node = tree.newNode(parentId, { depth: d, index: b });
        if (b === 0) {
          currentParentId = node.id;
        }
      }
    }

    // Benchmark traversal
    for (let i = 0; i < 100; i++) {
      tree.getAncestors(currentParentId);
    }
  });
});
