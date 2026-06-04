import { bench, describe } from 'vitest';
import { RepTree } from '../src/RepTree';

describe('RepTree Scaling Performance', () => {
  bench('tree size scaling - 1000 nodes', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();

    // Create a tree with 1000 nodes
    for (let i = 0; i < 1000; i++) {
      tree.newNode(root.id, { name: `node-${i}` });
    }

    // Perform a standard operation to measure performance at this scale
    tree.getAllNodes();
  });

  bench('tree size scaling - 5000 nodes', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();

    // Create a tree with 5000 nodes
    for (let i = 0; i < 5000; i++) {
      tree.newNode(root.id, { name: `node-${i}` });
    }

    // Perform a standard operation to measure performance at this scale
    tree.getAllNodes();
  });

  bench('deep tree traversal', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();

    // Create a deep tree (chain of nodes)
    let currentParentId = root.id;
    for (let i = 0; i < 100; i++) {
      const node = tree.newNode(currentParentId, { depth: i });
      currentParentId = node.id;
    }

    // Benchmark traversal of the deep tree
    tree.getAncestors(currentParentId);
  });

  bench('wide tree traversal', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();

    // Create a wide tree (many children at one level)
    for (let i = 0; i < 1000; i++) {
      tree.newNode(root.id, { index: i });
    }

    // Benchmark getting all children
    tree.getChildren(root.id);
  });
});
