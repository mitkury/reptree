import { RepTree } from "../dist/index.js";
import { strict as assert } from 'assert';

type RandomAction = 'move' | 'create' | 'setProperty';

type SyncStats = {
  totalOperations: number;
  totalOperationsTransferred: number;
  syncRounds: number;
};

/**
 * Fuzzy test that uses state vectors for synchronization between trees
 */
export function vectorFuzzyTest(
  treesCount: number = 3, 
  rounds: number = 5, 
  actionsPerRound: number = 100
): { trees: RepTree[], stats: SyncStats } {
  if (treesCount < 2) {
    throw new Error("treesCount must be at least 2");
  }

  const stats: SyncStats = {
    totalOperations: 0,
    totalOperationsTransferred: 0,
    syncRounds: 0
  };

  console.log(`🧪 Starting Vector-Based Fuzzy Test with ${treesCount} trees, ${rounds} rounds, ${actionsPerRound} actions per round`);
  
  // Create the trees
  const trees: RepTree[] = [];
  for (let i = 0; i < treesCount; i++) {
    trees.push(new RepTree(`peer${i+1}`));
  }

  // Run multiple rounds of random operations and vector-based sync
  for (let round = 0; round < rounds; round++) {
    console.log(`🔄 Round ${round + 1}: Executing random operations...`);
    
    let roundOperations = 0;
    
    // Each tree performs random operations independently
    for (let treeIndex = 0; treeIndex < treesCount; treeIndex++) {
      const tree = trees[treeIndex];
      const initialOpsCount = tree.getAllOps().length;
      
      for (let i = 0; i < actionsPerRound; i++) {
        executeRandomAction(tree);
      }
      
      const newOpsCount = tree.getAllOps().length - initialOpsCount;
      roundOperations += newOpsCount;
      console.log(`  Tree ${treeIndex + 1} created ${newOpsCount} new operations`);
    }
    
    stats.totalOperations += roundOperations;
    console.log(`  Total new operations in round: ${roundOperations}`);

    // After all trees have performed their actions, perform vector-based synchronization
    console.log(`📊 Round ${round + 1}: Vector-based synchronization...`);
    const roundTransferred = synchronizeTrees(trees);
    stats.totalOperationsTransferred += roundTransferred;
    stats.syncRounds++;
    
    // Efficiency calculation for this round
    const maxPossibleTransfers = roundOperations * (treesCount - 1) * treesCount;
    const actualTransfers = roundTransferred;
    const efficiency = ((maxPossibleTransfers - actualTransfers) / maxPossibleTransfers) * 100;
    const savedTransfers = maxPossibleTransfers - actualTransfers;
    
    console.log(`  Round efficiency: ${efficiency.toFixed(2)}%`);
    console.log(`  Maximum theoretical transfers: ${maxPossibleTransfers}`);
    console.log(`  Actual transfers: ${actualTransfers}`);
    console.log(`  Transfers saved: ${savedTransfers} (${efficiency.toFixed(2)}%)`);
    
    // Verify all trees have identical structure
    console.log(`🔍 Round ${round + 1}: Verifying tree structures...`);
    verifyTreeStructures(trees);
    
    console.log(`✅ Round ${round + 1}: Trees successfully synchronized`);
  }

  // Calculate overall efficiency
  const allPossibleTransfers = stats.totalOperations * (treesCount - 1) * treesCount;
  const overallEfficiency = ((allPossibleTransfers - stats.totalOperationsTransferred) / allPossibleTransfers) * 100;
  
  console.log(`\n📈 Final Statistics:`);
  console.log(`  Total operations created: ${stats.totalOperations}`);
  console.log(`  Maximum theoretical transfers: ${allPossibleTransfers}`);
  console.log(`  Actual operations transferred: ${stats.totalOperationsTransferred}`);
  console.log(`  Transfers saved: ${allPossibleTransfers - stats.totalOperationsTransferred} (${overallEfficiency.toFixed(2)}%)`);
  console.log(`  Average operations per sync: ${(stats.totalOperationsTransferred / (treesCount * (treesCount - 1) * stats.syncRounds)).toFixed(2)}`);
  
  console.log(`🎉 Vector-Based Fuzzy Test completed successfully!`);
  return { trees, stats };
}

/**
 * Synchronizes all trees using state vectors
 * Returns the total number of operations transferred
 */
function synchronizeTrees(trees: RepTree[]): number {
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
        console.log(`  Tree ${i+1} receiving ${missingOps.length} ops from Tree ${j+1}`);
        trees[i].merge(missingOps);
      }
    }
  }
  
  return totalTransferred;
}

/**
 * Verifies that all trees have identical structure
 */
function verifyTreeStructures(trees: RepTree[]): void {
  for (let i = 1; i < trees.length; i++) {
    const areEqual = trees[0].compareStructure(trees[i]);
    assert(areEqual, `Tree 1 and Tree ${i+1} structures differ after synchronization`);
  }
}

/**
 * Execute a random action on the given tree
 */
function executeRandomAction(tree: RepTree): void {
  const vertices = tree.getAllVertices();
  
  if (vertices.length <= 1) {
    // If only root vertex, just create a child
    tree.newVertex(tree.rootVertexId);
    return;
  }

  // Pick a random action
  const actionType = pickRandomAction();
  
  // Pick a random vertex (excluding void vertex and the root for some actions)
  const nonRootVertices = vertices.filter(v => v.id !== tree.rootVertexId && v.id !== 'v');
  
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
        
        // Skip move if it would create a cycle
        if (!tree.isAncestor(targetVertex.id, vertexToMove.id)) {
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

/**
 * Pick a random action type
 */
function pickRandomAction(): RandomAction {
  const actions: RandomAction[] = ['move', 'create', 'setProperty'];
  const index = Math.floor(Math.random() * actions.length);
  return actions[index];
}

// Run the test
console.log("Running Vector-Based Fuzzy Test...");
// Use smaller values for faster testing: 3 trees, 2 rounds, 20 actions per round
vectorFuzzyTest(3, 10, 1000);
console.log("Vector-Based Fuzzy Test completed successfully!"); 