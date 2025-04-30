import { fuzzyTest } from './fuzzyTests.js';

console.log('🧪 Running RepTree tests...');

// Run with 3 trees, 5 tries, 100 moves per try
const trees = fuzzyTest(3, 10, 1000);

console.log('✅ All tests passed!');
console.log(`Trees final state comparison: ${trees.length} trees are identical`); 