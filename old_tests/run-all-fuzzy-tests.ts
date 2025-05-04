import { fuzzyTest } from './fuzzyTests.js';
import { vectorFuzzyTest } from './vector-fuzzy.test.js';
import { SyncStats } from './shared-fuzzy-utils.js';

/**
 * Run both fuzzy tests with the same parameters and compare results
 */
function runComparisonTests(
  treesCount: number = 3,
  rounds: number = 5,
  actionsPerRound: number = 100
): void {
  console.log(`\n================================================`);
  console.log(`🔬 RUNNING COMPARISON TESTS WITH:`);
  console.log(`  - ${treesCount} trees`);
  console.log(`  - ${rounds} rounds`);
  console.log(`  - ${actionsPerRound} actions per round`);
  console.log(`================================================\n`);

  // Run the all-ops fuzzy test
  console.log(`\n🧪 STARTING ALL-OPS FUZZY TEST...\n`);
  const allOpsStart = Date.now();
  const allOpsResult = fuzzyTest(treesCount, rounds, actionsPerRound);
  const allOpsEnd = Date.now();
  const allOpsDuration = (allOpsEnd - allOpsStart) / 1000;

  // Run the vector-based fuzzy test
  console.log(`\n🧪 STARTING VECTOR-BASED FUZZY TEST...\n`);
  const vectorStart = Date.now();
  const vectorResult = vectorFuzzyTest(treesCount, rounds, actionsPerRound);
  const vectorEnd = Date.now();
  const vectorDuration = (vectorEnd - vectorStart) / 1000;

  // Print comparison
  console.log(`\n================================================`);
  console.log(`📊 COMPARISON RESULTS:`);
  console.log(`================================================\n`);

  const allOpsStats = allOpsResult.stats;
  const vectorStats = vectorResult.stats;

  // Calculate efficiency metrics
  const maxPossibleTransfers = allOpsStats.totalOperations * (treesCount - 1) * treesCount;
  const allOpsEfficiency = 0; // All-ops always sends everything
  const vectorEfficiency = ((maxPossibleTransfers - vectorStats.totalOperationsTransferred) / maxPossibleTransfers) * 100;

  console.log(`⏱️  EXECUTION TIME:`);
  console.log(`  All-Ops Test: ${allOpsDuration.toFixed(2)} seconds`);
  console.log(`  Vector Test:  ${vectorDuration.toFixed(2)} seconds`);
  console.log(`  Time savings: ${((allOpsDuration - vectorDuration) / allOpsDuration * 100).toFixed(2)}%`);
  
  console.log(`\n📈 OPERATIONS GENERATED:`);
  console.log(`  All-Ops Test: ${allOpsStats.totalOperations} operations`);
  console.log(`  Vector Test:  ${vectorStats.totalOperations} operations`);

  console.log(`\n🔄 OPERATIONS TRANSFERRED:`);
  console.log(`  All-Ops Test: ${allOpsStats.totalOperationsTransferred} operations`);
  console.log(`  Vector Test:  ${vectorStats.totalOperationsTransferred} operations`);
  console.log(`  Difference:   ${allOpsStats.totalOperationsTransferred - vectorStats.totalOperationsTransferred} operations`);
  console.log(`  Transfer savings: ${((allOpsStats.totalOperationsTransferred - vectorStats.totalOperationsTransferred) / allOpsStats.totalOperationsTransferred * 100).toFixed(2)}%`);

  console.log(`\n📊 EFFICIENCY (% of unnecessary transfers avoided):`);
  console.log(`  All-Ops Test: ${allOpsEfficiency.toFixed(2)}% (always sends all ops)`);
  console.log(`  Vector Test:  ${vectorEfficiency.toFixed(2)}%`);
  
  console.log(`\n✅ BOTH TESTS COMPLETED SUCCESSFULLY!\n`);
}

// Run comparison tests with reasonable defaults
runComparisonTests(3, 5, 100); 