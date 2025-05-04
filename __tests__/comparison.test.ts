import { describe, test, expect } from 'vitest';
import { RepTree } from '../dist/index.js';

// Types for tracking sync stats
type SyncStats = {
  totalOperations: number;
  totalOperationsTransferred: number;
  syncRounds: number;
  executionTimeMs: number;
};

type RandomAction = 'move' | 'create' | 'setProperty';

// Improved random action execution based on shared-fuzzy-utils.ts
function executeRandomAction(tree: RepTree): void {
  const vertices = tree.getAllVertices();
  
  if (vertices.length <= 1) {
    // If only root vertex, just create a child
    tree.newVertex(tree.rootVertexId);
    return;
  }

  // Pick a random action
  const actionType = pickRandomAction();
  
  // Pick a random vertex (excluding void vertex)
  const nonRootVertices = vertices.filter(v => v.id !== tree.rootVertexId);
  
  switch (actionType) {
    case 'create':
      // Can create under any vertex
      const parentIndex = Math.floor(Math.random() * vertices.length);
      tree.newVertex(vertices[parentIndex].id);
      break;
    
    case 'move':
      // Need non-root vertices to move
      if (nonRootVertices.length < 1) {
        // If no non-root vertices, just create a new vertex
        tree.newVertex(tree.rootVertexId);
      } else {
        // Pick a vertex to move (not the root)
        const moveIndex = Math.floor(Math.random() * nonRootVertices.length);
        const vertexToMove = nonRootVertices[moveIndex];
        
        // Pick a target vertex to move to (could be any vertex except the one we're moving)
        const possibleTargets = vertices.filter(v => v.id !== vertexToMove.id);
        const targetIndex = Math.floor(Math.random() * possibleTargets.length);
        const targetVertex = possibleTargets[targetIndex];
        
        // Only attempt move if we're not creating a cycle
        // This is a simplified check - the real isAncestor would be more comprehensive
        const childrenIds = tree.getChildrenIds(vertexToMove.id);
        if (!childrenIds.includes(targetVertex.id)) {
          tree.moveVertex(vertexToMove.id, targetVertex.id);
        }
      }
      break;
    
    case 'setProperty':
      // Can set property on any vertex
      const vertexIndex = Math.floor(Math.random() * vertices.length);
      const vertex = vertices[vertexIndex];
      
      const propName = `prop_${Math.floor(Math.random() * 10)}`;
      const propValue = `value_${Math.floor(Math.random() * 100)}`;
      
      tree.setVertexProperty(vertex.id, propName, propValue);
      break;
  }
}

// Pick a random action type
function pickRandomAction(): RandomAction {
  const actions: RandomAction[] = ['move', 'create', 'setProperty'];
  const index = Math.floor(Math.random() * actions.length);
  return actions[index];
}

// Create test trees
function createTestTrees(treesCount: number): RepTree[] {
  const trees: RepTree[] = [];
  for (let i = 0; i < treesCount; i++) {
    trees.push(new RepTree(`peer${i+1}`));
  }
  return trees;
}

// Perform random operations on all trees
function performRandomOperations(trees: RepTree[], actionsPerTree: number): number {
  let totalNewOps = 0;
  
  for (let treeIndex = 0; treeIndex < trees.length; treeIndex++) {
    const tree = trees[treeIndex];
    const initialOpsCount = tree.getAllOps().length;
    
    for (let i = 0; i < actionsPerTree; i++) {
      executeRandomAction(tree);
    }
    
    const newOpsCount = tree.getAllOps().length - initialOpsCount;
    totalNewOps += newOpsCount;
  }
  
  return totalNewOps;
}

// Verify that all trees have identical structure
function verifyTreeStructures(trees: RepTree[]): void {
  for (let i = 1; i < trees.length; i++) {
    const areEqual = trees[0].compareStructure(trees[i]);
    if (!areEqual) {
      // For diagnostic purposes, log some information about the divergence
      console.error(`\n🔍 DIVERGENCE DETECTED between Tree 1 and Tree ${i+1}`);
      
      // Compare vertex counts
      const tree1VertexCount = trees[0].getAllVertices().length;
      const tree2VertexCount = trees[i].getAllVertices().length;
      console.error(`Vertex counts: Tree 1 has ${tree1VertexCount}, Tree ${i+1} has ${tree2VertexCount}`);
      
      throw new Error(`Tree 1 and Tree ${i+1} structures differ after synchronization`);
    }
  }
}

// Sync with all operations approach
function syncWithAllOps(trees: RepTree[]): number {
  const treeCount = trees.length;
  let totalTransferred = 0;
  
  for (let i = 0; i < treeCount; i++) {
    const sourceTree = trees[i];
    const ops = sourceTree.getAllOps();
    
    for (let j = 0; j < treeCount; j++) {
      if (i !== j) {
        trees[j].merge(ops);
        totalTransferred += ops.length;
      }
    }
  }
  
  return totalTransferred;
}

// Sync with state vectors approach
function syncWithStateVectors(trees: RepTree[]): number {
  const treeCount = trees.length;
  let totalTransferred = 0;
  
  // Get all trees' state vectors first
  const stateVectors = trees.map(tree => tree.getStateVector());
  
  // For each tree, calculate and apply missing ops from all other trees
  for (let i = 0; i < treeCount; i++) {
    for (let j = 0; j < treeCount; j++) {
      if (i === j) continue; // Skip self
      
      // Get missing ops from tree j that tree i needs
      const missingOps = trees[j].getMissingOps(stateVectors[i]);
      totalTransferred += missingOps.length;
      
      if (missingOps.length > 0) {
        trees[i].merge(missingOps);
      }
    }
  }
  
  return totalTransferred;
}

// Run fuzzy test with full operation exchange
function runAllOpsFuzzyTest(
  treesCount: number,
  rounds: number, 
  actionsPerRound: number
): { trees: RepTree[], stats: SyncStats } {
  const stats: SyncStats = {
    totalOperations: 0,
    totalOperationsTransferred: 0,
    syncRounds: 0,
    executionTimeMs: 0
  };

  console.log(`🧪 Starting All-Ops Fuzzy Test (${treesCount} trees, ${rounds} rounds, ${actionsPerRound} actions per round)`);
  
  const startTime = Date.now();
  
  // Create the trees
  const trees = createTestTrees(treesCount);

  // Run multiple rounds of random operations and full-ops sync
  for (let round = 0; round < rounds; round++) {
    console.log(`Round ${round + 1}/${rounds}: Operations...`);
    
    // Each tree performs random operations independently
    const roundOperations = performRandomOperations(trees, actionsPerRound);
    stats.totalOperations += roundOperations;
    
    console.log(`Round ${round + 1}/${rounds}: Sync (all-ops)...`);
    const roundTransferred = syncWithAllOps(trees);
    stats.totalOperationsTransferred += roundTransferred;
    stats.syncRounds++;
    
    // Verify all trees have identical structure
    verifyTreeStructures(trees);
  }

  const endTime = Date.now();
  stats.executionTimeMs = endTime - startTime;
  
  return { trees, stats };
}

// Run fuzzy test with state vector based synchronization
function runVectorFuzzyTest(
  treesCount: number,
  rounds: number, 
  actionsPerRound: number
): { trees: RepTree[], stats: SyncStats } {
  const stats: SyncStats = {
    totalOperations: 0,
    totalOperationsTransferred: 0,
    syncRounds: 0,
    executionTimeMs: 0
  };

  console.log(`🧪 Starting Vector Fuzzy Test (${treesCount} trees, ${rounds} rounds, ${actionsPerRound} actions per round)`);
  
  const startTime = Date.now();
  
  // Create the trees
  const trees = createTestTrees(treesCount);

  // Run multiple rounds of random operations and vector-based sync
  for (let round = 0; round < rounds; round++) {
    console.log(`Round ${round + 1}/${rounds}: Operations...`);
    
    // Each tree performs random operations independently
    const roundOperations = performRandomOperations(trees, actionsPerRound);
    stats.totalOperations += roundOperations;
    
    console.log(`Round ${round + 1}/${rounds}: Sync (vector-based)...`);
    const roundTransferred = syncWithStateVectors(trees);
    stats.totalOperationsTransferred += roundTransferred;
    stats.syncRounds++;
    
    // Verify all trees have identical structure
    verifyTreeStructures(trees);
  }

  const endTime = Date.now();
  stats.executionTimeMs = endTime - startTime;
  
  return { trees, stats };
}

describe('RepTree Synchronization Methods Comparison', () => {
  test('should compare efficiency of all-ops vs. state-vector sync', () => {
    const treesCount = 3;
    const rounds = 3;
    const actionsPerRound = 50; // Using smaller numbers for faster tests
    
    // Run the all-ops fuzzy test
    const allOpsResult = runAllOpsFuzzyTest(treesCount, rounds, actionsPerRound);
    
    // Run the vector-based fuzzy test
    const vectorResult = runVectorFuzzyTest(treesCount, rounds, actionsPerRound);
    
    // Calculate comparison metrics
    const allOpsStats = allOpsResult.stats;
    const vectorStats = vectorResult.stats;
    
    const maxPossibleTransfers = allOpsStats.totalOperations * (treesCount - 1) * treesCount;
    const allOpsEfficiency = 0; // All-ops always sends everything
    const vectorEfficiency = ((maxPossibleTransfers - vectorStats.totalOperationsTransferred) / maxPossibleTransfers) * 100;
    
    // Print comparison results
    console.log('\n📊 COMPARISON RESULTS:');
    
    console.log(`⏱️  EXECUTION TIME:`);
    console.log(`  All-Ops:   ${(allOpsStats.executionTimeMs / 1000).toFixed(2)} seconds`);
    console.log(`  Vector:    ${(vectorStats.executionTimeMs / 1000).toFixed(2)} seconds`);
    console.log(`  Savings:   ${((allOpsStats.executionTimeMs - vectorStats.executionTimeMs) / allOpsStats.executionTimeMs * 100).toFixed(2)}%`);
    
    console.log(`\n🔄 OPERATIONS TRANSFERRED:`);
    console.log(`  All-Ops:   ${allOpsStats.totalOperationsTransferred} ops`);
    console.log(`  Vector:    ${vectorStats.totalOperationsTransferred} ops`);
    console.log(`  Savings:   ${((allOpsStats.totalOperationsTransferred - vectorStats.totalOperationsTransferred) / allOpsStats.totalOperationsTransferred * 100).toFixed(2)}%`);
    
    console.log(`\n📊 EFFICIENCY (unnecessary transfers avoided):`);
    console.log(`  All-Ops:   ${allOpsEfficiency.toFixed(2)}%`);
    console.log(`  Vector:    ${vectorEfficiency.toFixed(2)}%`);
    
    // Don't compare structures since the tests use different random operations
    // expect(allOpsResult.trees[0].compareStructure(vectorResult.trees[0])).toBe(true);
    
    // Verify that vector-based sync should be more efficient
    expect(vectorStats.totalOperationsTransferred).toBeLessThan(allOpsStats.totalOperationsTransferred);
    
    // Log the tree sizes for context
    const allOpsVertices = allOpsResult.trees[0].getAllVertices().length;
    const vectorVertices = vectorResult.trees[0].getAllVertices().length;
    console.log(`\nTree sizes: All-Ops: ${allOpsVertices} vertices, Vector: ${vectorVertices} vertices`);
    
    // Check that we have a meaningful number of operations in both tests
    expect(allOpsStats.totalOperations).toBeGreaterThan(100);
    expect(vectorStats.totalOperations).toBeGreaterThan(100);
    
    // Verify that we actually saved something with vector-based sync
    expect(vectorEfficiency).toBeGreaterThan(25);
  });
}); 