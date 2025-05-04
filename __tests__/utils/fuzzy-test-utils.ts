import { RepTree } from '../../dist/index.js';

/**
 * Stats for tracking synchronization performance metrics
 */
export type SyncStats = {
  /** Total number of operations generated across all trees */
  totalOperations: number;
  /** Total number of operations transferred during synchronization */
  totalOperationsTransferred: number;
  /** Number of synchronization rounds performed */
  syncRounds: number;
  /** Total execution time in milliseconds */
  executionTimeMs: number;
};

/**
 * Types of random actions that can be performed on a tree
 */
export type RandomAction = 'move' | 'create' | 'setProperty';

/**
 * Execute a random action on the given tree
 * 
 * This function randomly selects one of three operations:
 * 1. Create a new vertex under a random parent
 * 2. Move a vertex to a new parent (avoiding cycles)
 * 3. Set a property on a random vertex
 * 
 * @param tree The RepTree instance to modify
 */
export function executeRandomAction(tree: RepTree): void {
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

/**
 * Pick a random action type from the available actions
 * 
 * @returns A random action type
 */
export function pickRandomAction(): RandomAction {
  const actions: RandomAction[] = ['move', 'create', 'setProperty'];
  const index = Math.floor(Math.random() * actions.length);
  return actions[index];
}

/**
 * Create a set of test trees with unique peer IDs
 * 
 * @param treesCount Number of trees to create
 * @returns Array of newly created RepTree instances
 */
export function createTestTrees(treesCount: number): RepTree[] {
  const trees: RepTree[] = [];
  for (let i = 0; i < treesCount; i++) {
    trees.push(new RepTree(`peer${i+1}`));
  }
  return trees;
}

/**
 * Perform random operations on all trees
 * 
 * @param trees Array of RepTree instances to perform operations on
 * @param actionsPerTree Number of random actions to perform on each tree
 * @returns The total number of operations created
 */
export function performRandomOperations(trees: RepTree[], actionsPerTree: number): number {
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

/**
 * Verify that all trees have identical structure
 * 
 * This function compares the first tree with all other trees to ensure
 * they have converged to the same state.
 * 
 * @param trees Array of RepTree instances to verify
 * @throws Error if any trees have divergent structures
 */
export function verifyTreeStructures(trees: RepTree[]): void {
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

/**
 * Synchronize trees using the full operations exchange approach
 * 
 * This method sends all operations from each tree to every other tree,
 * which is simple but inefficient.
 * 
 * @param trees Array of RepTree instances to synchronize
 * @returns The total number of operations transferred
 */
export function syncWithAllOps(trees: RepTree[]): number {
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

/**
 * Synchronize trees using state vectors to only send missing operations
 * 
 * This method is more efficient than syncWithAllOps as it only transfers
 * operations that the target tree doesn't already have.
 * 
 * @param trees Array of RepTree instances to synchronize
 * @returns The total number of operations transferred
 */
export function syncWithStateVectors(trees: RepTree[]): number {
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

/**
 * Run a fuzzy test with full operation exchange
 * 
 * This test creates multiple trees, performs random operations on each,
 * and synchronizes them using the full operations exchange approach.
 * 
 * @param treesCount Number of trees to create
 * @param rounds Number of rounds of operations to perform
 * @param actionsPerRound Number of actions per tree per round
 * @returns Object containing the trees and stats about the test run
 */
export function runAllOpsFuzzyTest(
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

/**
 * Run a fuzzy test with state vector based synchronization
 * 
 * This test creates multiple trees, performs random operations on each,
 * and synchronizes them using the more efficient state vector approach.
 * 
 * @param treesCount Number of trees to create
 * @param rounds Number of rounds of operations to perform
 * @param actionsPerRound Number of actions per tree per round
 * @returns Object containing the trees and stats about the test run
 */
export function runVectorFuzzyTest(
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