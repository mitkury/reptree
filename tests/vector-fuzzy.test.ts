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
    if (!areEqual) {
      // Gather diagnostic information
      console.error(`\n🔍 DIVERGENCE DETECTED between Tree 1 and Tree ${i+1}`);
      
      // Compare vertex counts
      const tree1VertexCount = trees[0].getAllVertices().length;
      const tree2VertexCount = trees[i].getAllVertices().length;
      console.error(`Vertex counts: Tree 1 has ${tree1VertexCount}, Tree ${i+1} has ${tree2VertexCount}`);
      
      // Check root vertex properties
      const root1Props = trees[0].getVertexProperties(trees[0].rootVertexId);
      const root2Props = trees[i].getVertexProperties(trees[i].rootVertexId);
      console.error(`Root properties count: Tree 1 root has ${root1Props.length}, Tree ${i+1} root has ${root2Props.length}`);
      
      // Check children counts of root
      const root1Children = trees[0].getChildrenIds(trees[0].rootVertexId);
      const root2Children = trees[i].getChildrenIds(trees[i].rootVertexId);
      console.error(`Root children count: Tree 1 root has ${root1Children.length}, Tree ${i+1} root has ${root2Children.length}`);
      
      // Find vertex IDs in one tree but not the other
      const tree1VertexIds = new Set(trees[0].getAllVertices().map(v => v.id));
      const tree2VertexIds = new Set(trees[i].getAllVertices().map(v => v.id));
      
      const onlyInTree1 = [...tree1VertexIds].filter(id => !tree2VertexIds.has(id));
      const onlyInTree2 = [...tree2VertexIds].filter(id => !tree1VertexIds.has(id));
      
      if (onlyInTree1.length > 0) {
        console.error(`Vertices only in Tree 1: ${onlyInTree1.length} (first 5: ${onlyInTree1.slice(0, 5).join(', ')})`);
      }
      
      if (onlyInTree2.length > 0) {
        console.error(`Vertices only in Tree ${i+1}: ${onlyInTree2.length} (first 5: ${onlyInTree2.slice(0, 5).join(', ')})`);
      }
      
      // If we have the same vertices but different structure, find parent differences
      if (onlyInTree1.length === 0 && onlyInTree2.length === 0) {
        console.error(`Trees have identical vertices but different structure. Checking parent relationships...`);
        
        // Sample up to 10 vertices to check their parents
        const sampleSize = Math.min(10, tree1VertexIds.size);
        const sampleVertices = [...tree1VertexIds].slice(0, sampleSize);
        
        for (const vertexId of sampleVertices) {
          const parent1 = trees[0].getParent(vertexId)?.id;
          const parent2 = trees[i].getParent(vertexId)?.id;
          
          if (parent1 !== parent2) {
            console.error(`Vertex ${vertexId} has different parents: Tree 1: ${parent1}, Tree ${i+1}: ${parent2}`);
          }
        }
      }
      
      // Output state vector information
      console.error(`\nState Vector Tree 1:`, JSON.stringify(trees[0].getStateVector()));
      console.error(`State Vector Tree ${i+1}:`, JSON.stringify(trees[i].getStateVector()));
      
      // Check last operation counts
      console.error(`\nTotal operations in Tree 1:`, trees[0].getAllOps().length);
      console.error(`Total operations in Tree ${i+1}:`, trees[i].getAllOps().length);
      
      // Suggest potential issues
      console.error(`\nPossible issues to investigate:`);
      console.error(`- Check if all operations were properly transferred between trees`);
      console.error(`- Look for race conditions in conflict resolution`);
      console.error(`- Examine cycles in tree structure that might affect isAncestor checks`);
      console.error(`- Inspect operation ordering during merge operations`);
    }
    
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