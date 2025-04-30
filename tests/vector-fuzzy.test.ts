import { RepTree } from "../dist/index.js";
import {
  createTestTrees,
  performRandomOperations,
  syncWithStateVectors,
  verifyTreeStructures,
  SyncStats
} from "./shared-fuzzy-utils.js";

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
  const trees = createTestTrees(treesCount);

  // Run multiple rounds of random operations and vector-based sync
  for (let round = 0; round < rounds; round++) {
    console.log(`🔄 Round ${round + 1}: Executing random operations...`);

    // Each tree performs random operations independently
    const roundOperations = performRandomOperations(trees, actionsPerRound);
    stats.totalOperations += roundOperations;

    // After all trees have performed their actions, perform vector-based synchronization
    console.log(`📊 Round ${round + 1}: Vector-based synchronization...`);
    const roundTransferred = syncWithStateVectors(trees);
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

// Run the test if this file is executed directly
console.log("Running Vector-Based Fuzzy Test...");
// Use smaller values for faster testing: 3 trees, 10 rounds, 1000 actions per round
vectorFuzzyTest(3, 10, 1000);
console.log("Vector-Based Fuzzy Test completed successfully!");