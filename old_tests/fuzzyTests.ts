import { RepTree } from "../dist/index.js";
import { 
  createTestTrees,
  performRandomOperations, 
  syncWithAllOps,
  verifyTreeStructures,
  SyncStats
} from "./shared-fuzzy-utils.js";

/**
 * Fuzzy test that uses full operation exchange for synchronization between trees
 */
export function fuzzyTest(
  treesCount: number = 3, 
  rounds: number = 10, 
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

  console.log(`🧪 Starting All-Ops Fuzzy Test with ${treesCount} trees, ${rounds} rounds, ${actionsPerRound} actions per round`);
  
  // Create the trees
  const trees = createTestTrees(treesCount);

  // Run multiple rounds of random operations and full-ops sync
  for (let round = 0; round < rounds; round++) {
    console.log(`🔄 Round ${round + 1}: Executing random operations...`);
    
    // Each tree performs random operations independently
    const roundOperations = performRandomOperations(trees, actionsPerRound);
    stats.totalOperations += roundOperations;
    
    // After all trees have performed their actions, sync them
    console.log(`📊 Round ${round + 1}: All-Ops synchronization...`);
    const roundTransferred = syncWithAllOps(trees);
    stats.totalOperationsTransferred += roundTransferred;
    stats.syncRounds++;
    
    // Verify all trees have identical structure
    console.log(`🔍 Round ${round + 1}: Verifying tree structures...`);
    verifyTreeStructures(trees);
    
    console.log(`✅ Round ${round + 1}: Trees successfully synchronized`);
  }

  // Calculate overall statistics
  const allPossibleTransfers = stats.totalOperations * (treesCount - 1) * treesCount;
  
  console.log(`\n📈 Final Statistics:`);
  console.log(`  Total operations created: ${stats.totalOperations}`);
  console.log(`  Total operations transferred: ${stats.totalOperationsTransferred}`);
  console.log(`  Average operations per sync: ${(stats.totalOperationsTransferred / (treesCount * (treesCount - 1) * stats.syncRounds)).toFixed(2)}`);
  
  console.log(`🎉 All-Ops Fuzzy Test completed successfully!`);
  return { trees, stats };
} 