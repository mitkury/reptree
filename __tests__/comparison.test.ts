import { describe, test, expect } from 'vitest';
import { 
  runAllOpsFuzzyTest, 
  runVectorFuzzyTest 
} from './utils/fuzzy-test-utils';

describe('RepTree Synchronization Methods Comparison', () => {
  test('should compare efficiency of all-ops vs. state-vector sync', () => {
    const treesCount = 3;
    const rounds = 10;
    const actionsPerRound = 1000; // Using smaller numbers for faster tests
    
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