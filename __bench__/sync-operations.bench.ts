import { bench, describe } from 'vitest';
import { RepTree } from '../src/RepTree';

describe('RepTree Synchronization Operations', () => {
  bench('operation merging', () => {
    // Setup two trees
    const treeA = new RepTree('peerA');
    const rootA = treeA.createRoot();
    
    // Create a batch of operations in the first tree
    for (let i = 0; i < 100; i++) {
      treeA.newVertex(rootA.id, { name: `vertex-${i}` });
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
      tree.newVertex(root.id, { name: `vertex-${i}` });
    }
    
    // Benchmark state vector operations
    for (let i = 0; i < 100; i++) {
      tree.getStateVector();
    }
  });

  bench('missing operations calculation', () => {
    // Setup two trees with different operations
    const treeA = new RepTree('peerA');
    const rootA = treeA.createRoot();
    
    // Create operations in the first tree
    for (let i = 0; i < 50; i++) {
      treeA.newVertex(rootA.id, { name: `vertex-A-${i}` });
    }
    
    // Create a second tree with some shared and some different operations
    const treeB = new RepTree('peerB');
    const rootB = treeB.createRoot();
    
    // Get operations from the first tree and apply some to the second
    const opsA = treeA.getAllOps();
    treeB.merge(opsA.slice(0, 25)); // Apply only half of the operations
    
    // Create some unique operations in the second tree
    for (let i = 0; i < 50; i++) {
      treeB.newVertex(rootB.id, { name: `vertex-B-${i}` });
    }
    
    // Get state vectors
    const stateVectorA = treeA.getStateVector();
    
    // Benchmark missing operations calculation
    if (stateVectorA) {
      treeB.getMissingOps(stateVectorA);
    }
  });
});
