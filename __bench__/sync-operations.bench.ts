import { bench, describe } from 'vitest';
import { RepTree } from '../src/RepTree';

describe('RepTree Synchronization Operations', () => {
  bench('operation merging', () => {
    // Setup two trees
    const treeA = new RepTree('peerA');
    const rootA = treeA.createRoot();

    // Create a batch of operations in the first tree
    for (let i = 0; i < 100; i++) {
      treeA.newNode(rootA.id, { name: `node-${i}` });
    }

    // Get operations from the first tree
    const ops = treeA.getAllOps();

    // Create a second tree and measure merging performance
    const treeB = new RepTree('peerB');

    // Benchmark merging operations
    treeB.merge(ops);
  });

  bench('state vector calculation', () => {
    // Setup a tree with operations
    const tree = new RepTree('peer1');
    const root = tree.createRoot();

    // Create a batch of operations
    for (let i = 0; i < 100; i++) {
      tree.newNode(root.id, { name: `node-${i}` });
    }

    // Benchmark state vector operations
    for (let i = 0; i < 100; i++) {
      tree.getStateVectors();
    }
  });

  bench('missing operations calculation', () => {
    // Setup two trees with different operations
    const treeA = new RepTree('peerA');
    const rootA = treeA.createRoot();

    // Create operations in the first tree
    for (let i = 0; i < 50; i++) {
      treeA.newNode(rootA.id, { name: `node-A-${i}` });
    }

    // Create a second tree with some shared and some different operations
    const treeB = new RepTree('peerB');
    const rootB = treeB.createRoot();

    // Get operations from the first tree and apply some to the second
    const opsA = treeA.getAllOps();
    treeB.merge(opsA.slice(0, 25)); // Apply only half of the operations

    // Create some unique operations in the second tree
    for (let i = 0; i < 50; i++) {
      treeB.newNode(rootB.id, { name: `node-B-${i}` });
    }

    // Get state vectors
    const stateVectorA = treeA.getStateVectors();

    // Benchmark missing operations calculation
    if (stateVectorA) {
      treeB.getMissingOps(stateVectorA);
    }
  });
});
