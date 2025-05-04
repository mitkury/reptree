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
    // If only root vertex, just create root
    tree.createRoot();
    return;
  }

  // Pick a random action
  const actionType = pickRandomAction();
  
  // Pick a random vertex (excluding void vertex)
  const nonRootVertices = vertices.filter(v => v.id !== tree.root?.id);
  
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
        tree.newVertex(tree.root!.id);
      } else {
        // Pick a vertex to move (not the root)
        const moveIndex = Math.floor(Math.random() * nonRootVertices.length);
        const vertexToMove = nonRootVertices[moveIndex];
        
        // Pick a target vertex to move to (could be any vertex except the one we're moving)
        const possibleTargets = vertices.filter(v => v.id !== vertexToMove.id);
        const targetIndex = Math.floor(Math.random() * possibleTargets.length);
        const targetVertex = possibleTargets[targetIndex];
        
        // Attempt move regardless of cycles to properly test CRDT
        tree.moveVertex(vertexToMove.id, targetVertex.id);
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
 * @returns A random action type with weighted distribution:
 * - 60% chance for 'move'
 * - 30% chance for 'create'
 * - 30% chance for 'setProperty'
 */
export function pickRandomAction(): RandomAction {
  const random = Math.random() * 120; // Total of percentages
  
  if (random < 60) {
    return 'move';
  } else if (random < 90) {
    return 'create';
  } else {
    return 'setProperty';
  }
}

/**
 * Create a set of test trees with unique peer IDs
 * 
 * @param treesCount Number of trees to create
 * @returns Array of newly created RepTree instances
 */
export function createTestTrees(treesCount: number): RepTree[] {
  const tree = new RepTree('original');
  tree.createRoot();
  const ops = tree.getAllOps();

  const trees: RepTree[] = [];
  for (let i = 0; i < treesCount; i++) {
    trees.push(new RepTree(`peer${i+1}`, ops));
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
      // For diagnostic purposes, log detailed information about the divergence
      console.error(`\n🔍 DIVERGENCE DETECTED between Tree 1 and Tree ${i+1}`);
      
      // Compare vertex counts
      const tree1VertexCount = trees[0].getAllVertices().length;
      const tree2VertexCount = trees[i].getAllVertices().length;
      console.error(`Vertex counts: Tree 1 has ${tree1VertexCount}, Tree ${i+1} has ${tree2VertexCount}`);
      
      // Find and report structural differences
      const tree1Vertices = trees[0].getAllVertices();
      const tree2Vertices = trees[i].getAllVertices();
      
      // Check for vertices present in tree1 but not in tree2
      const tree2VertexIds = new Set(tree2Vertices.map(v => v.id));
      const missingInTree2 = tree1Vertices.filter(v => !tree2VertexIds.has(v.id));
      if (missingInTree2.length > 0) {
        console.error(`Vertices present in Tree 1 but missing in Tree ${i+1}:`, 
          missingInTree2.map(v => v.id).slice(0, 5).join(', ') + 
          (missingInTree2.length > 5 ? ` and ${missingInTree2.length - 5} more...` : ''));
      }
      
      // Check for vertices present in tree2 but not in tree1
      const tree1VertexIds = new Set(tree1Vertices.map(v => v.id));
      const missingInTree1 = tree2Vertices.filter(v => !tree1VertexIds.has(v.id));
      if (missingInTree1.length > 0) {
        console.error(`Vertices present in Tree ${i+1} but missing in Tree 1:`, 
          missingInTree1.map(v => v.id).slice(0, 5).join(', ') + 
          (missingInTree1.length > 5 ? ` and ${missingInTree1.length - 5} more...` : ''));
      }
      
      // Check for vertices with different parents
      const commonVertices = tree1Vertices.filter(v => tree2VertexIds.has(v.id));
      const verticesWithDifferentParents = commonVertices.filter(v1 => {
        const v2 = trees[i].getVertex(v1.id);
        return v2 && v1.parentId !== v2.parentId;
      });
      
      if (verticesWithDifferentParents.length > 0) {
        console.error(`Vertices with different parents between Tree 1 and Tree ${i+1}:`);
        verticesWithDifferentParents.slice(0, 5).forEach(v1 => {
          const v2 = trees[i].getVertex(v1.id);
          if (v2) {
            console.error(`  Vertex ${v1.id}: parent in Tree 1 = ${v1.parentId}, parent in Tree ${i+1} = ${v2.parentId}`);
          }
        });
        if (verticesWithDifferentParents.length > 5) {
          console.error(`  ... and ${verticesWithDifferentParents.length - 5} more`);
        }
      }
      
      // Check for vertices with different properties
      const verticesWithDifferentProps = commonVertices.filter(v1 => {
        const v2 = trees[i].getVertex(v1.id);
        if (!v2) return false;
        
        const props1 = trees[0].getVertexProperties(v1.id);
        const props2 = trees[i].getVertexProperties(v2.id);
        
        if (props1.length !== props2.length) return true;
        
        for (const prop1 of props1) {
          const prop2 = props2.find(p => p.key === prop1.key);
          if (!prop2 || prop1.value !== prop2.value) return true;
        }
        
        return false;
      });
      
      if (verticesWithDifferentProps.length > 0) {
        console.error(`Vertices with different properties between Tree 1 and Tree ${i+1}:`);
        verticesWithDifferentProps.slice(0, 5).forEach(v1 => {
          const v2 = trees[i].getVertex(v1.id);
          if (v2) {
            const props1 = trees[0].getVertexProperties(v1.id);
            const props2 = trees[i].getVertexProperties(v2.id);
            
            console.error(`  Vertex ${v1.id} properties:`);
            console.error(`    Tree 1: ${JSON.stringify(props1)}`);
            console.error(`    Tree ${i+1}: ${JSON.stringify(props2)}`);
            
            // Find specific property differences
            const allKeys = new Set([...props1.map(p => p.key), ...props2.map(p => p.key)]);
            for (const key of allKeys) {
              const p1 = props1.find(p => p.key === key);
              const p2 = props2.find(p => p.key === key);
              
              if (!p1) {
                console.error(`    Property "${key}" only in Tree ${i+1}: ${p2?.value}`);
              } else if (!p2) {
                console.error(`    Property "${key}" only in Tree 1: ${p1.value}`);
              } else if (p1.value !== p2.value) {
                console.error(`    Property "${key}" differs: Tree 1 = ${p1.value}, Tree ${i+1} = ${p2.value}`);
              }
            }
          }
        });
        if (verticesWithDifferentProps.length > 5) {
          console.error(`  ... and ${verticesWithDifferentProps.length - 5} more`);
        }
      }
      
      // Check if their root vertices differ
      if (trees[0].root?.id !== trees[i].root?.id) {
        console.error(`Root vertices differ: Tree 1 root = ${trees[0].root?.id}, Tree ${i+1} root = ${trees[i].root?.id}`);
      }
      
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
      const stateVector = stateVectors[i];
      if (stateVector) {
        const missingOps = trees[j].getMissingOps(stateVector);
        totalTransferred += missingOps.length;
        
        if (missingOps.length > 0) {
          trees[i].merge(missingOps);
        }
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