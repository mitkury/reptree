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
 * 1. Create a new node under a random parent
 * 2. Move a node to a new parent (avoiding cycles)
 * 3. Set a property on a random node
 *
 * @param tree The RepTree instance to modify
 */
export function executeRandomAction(tree: RepTree): void {
  const nodes = tree.getAllNodes();

  if (nodes.length <= 1) {
    // If only root node, just create root
    tree.createRoot();
    return;
  }

  // Pick a random action
  const actionType = pickRandomAction();

  // Pick a random node (excluding void node)
  const nonRootNodes = nodes.filter(v => v.id !== tree.root?.id);

  switch (actionType) {
    case 'create':
      // Can create under any node
      const parentIndex = Math.floor(Math.random() * nodes.length);
      tree.newNode(nodes[parentIndex].id);
      break;

    case 'move':
      // Need non-root nodes to move
      if (nonRootNodes.length < 1) {
        // If no non-root nodes, just create a new node
        tree.newNode(tree.root!.id);
      } else {
        // Pick a node to move (not the root)
        const moveIndex = Math.floor(Math.random() * nonRootNodes.length);
        const nodeToMove = nonRootNodes[moveIndex];

        // Pick a target node to move to (could be any node except the one we're moving)
        const possibleTargets = nodes.filter(v => v.id !== nodeToMove.id);
        const targetIndex = Math.floor(Math.random() * possibleTargets.length);
        const targetNode = possibleTargets[targetIndex];

        // Attempt move regardless of cycles to properly test CRDT
        tree.moveNode(nodeToMove.id, targetNode.id);
      }
      break;

    case 'setProperty':
      // Can set property on any node
      const nodeIndex = Math.floor(Math.random() * nodes.length);
      const node = nodes[nodeIndex];

      const propName = `prop_${Math.floor(Math.random() * 10)}`;
      const propValue = `value_${Math.floor(Math.random() * 100)}`;

      tree.setNodeProperty(node.id, propName, propValue);
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

      // Compare node counts
      const tree1NodeCount = trees[0].getAllNodes().length;
      const tree2NodeCount = trees[i].getAllNodes().length;
      console.error(`Node counts: Tree 1 has ${tree1NodeCount}, Tree ${i+1} has ${tree2NodeCount}`);

      // Find and report structural differences
      const tree1Nodes = trees[0].getAllNodes();
      const tree2Nodes = trees[i].getAllNodes();

      // Check for nodes present in tree1 but not in tree2
      const tree2NodeIds = new Set(tree2Nodes.map(v => v.id));
      const missingInTree2 = tree1Nodes.filter(v => !tree2NodeIds.has(v.id));
      if (missingInTree2.length > 0) {
        console.error(`Nodes present in Tree 1 but missing in Tree ${i+1}:`,
          missingInTree2.map(v => v.id).slice(0, 5).join(', ') +
          (missingInTree2.length > 5 ? ` and ${missingInTree2.length - 5} more...` : ''));
      }

      // Check for nodes present in tree2 but not in tree1
      const tree1NodeIds = new Set(tree1Nodes.map(v => v.id));
      const missingInTree1 = tree2Nodes.filter(v => !tree1NodeIds.has(v.id));
      if (missingInTree1.length > 0) {
        console.error(`Nodes present in Tree ${i+1} but missing in Tree 1:`,
          missingInTree1.map(v => v.id).slice(0, 5).join(', ') +
          (missingInTree1.length > 5 ? ` and ${missingInTree1.length - 5} more...` : ''));
      }

      // Check for nodes with different parents
      const commonNodes = tree1Nodes.filter(v => tree2NodeIds.has(v.id));
      const nodesWithDifferentParents = commonNodes.filter(v1 => {
        const v2 = trees[i].getNode(v1.id);
        return v2 && v1.parentId !== v2.parentId;
      });

      if (nodesWithDifferentParents.length > 0) {
        console.error(`Nodes with different parents between Tree 1 and Tree ${i+1}:`);
        nodesWithDifferentParents.slice(0, 5).forEach(v1 => {
          const v2 = trees[i].getNode(v1.id);
          if (v2) {
            console.error(`  Node ${v1.id}: parent in Tree 1 = ${v1.parentId}, parent in Tree ${i+1} = ${v2.parentId}`);
          }
        });
        if (nodesWithDifferentParents.length > 5) {
          console.error(`  ... and ${nodesWithDifferentParents.length - 5} more`);
        }
      }

      // Check for nodes with different properties
      const nodesWithDifferentProps = commonNodes.filter(v1 => {
        const v2 = trees[i].getNode(v1.id);
        if (!v2) return false;

        const props1 = trees[0].getNodeProperties(v1.id);
        const props2 = trees[i].getNodeProperties(v2.id);

        if (props1.length !== props2.length) return true;

        for (const prop1 of props1) {
          const prop2 = props2.find(p => p.key === prop1.key);
          if (!prop2 || prop1.value !== prop2.value) return true;
        }

        return false;
      });

      if (nodesWithDifferentProps.length > 0) {
        console.error(`Nodes with different properties between Tree 1 and Tree ${i+1}:`);
        nodesWithDifferentProps.slice(0, 5).forEach(v1 => {
          const v2 = trees[i].getNode(v1.id);
          if (v2) {
            const props1 = trees[0].getNodeProperties(v1.id);
            const props2 = trees[i].getNodeProperties(v2.id);

            console.error(`  Node ${v1.id} properties:`);
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
        if (nodesWithDifferentProps.length > 5) {
          console.error(`  ... and ${nodesWithDifferentProps.length - 5} more`);
        }
      }

      // Check if their root nodes differ
      if (trees[0].root?.id !== trees[i].root?.id) {
        console.error(`Root nodes differ: Tree 1 root = ${trees[0].root?.id}, Tree ${i+1} root = ${trees[i].root?.id}`);
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
  const stateVectors = trees.map(tree => tree.getStateVectors());

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
