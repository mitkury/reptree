# RepTree Tests

This directory contains tests for the RepTree library.

## Test Structure

- **basic-usage.test.ts**: Simple test based on the README example, verifying basic functionality
- **fuzzy.test.ts**: Performs random operations on multiple trees and synchronizes them using the full-ops approach
- **state-vector-sync.test.ts**: Tests synchronization using state vectors to only send missing operations
- **comparison.test.ts**: Compares the efficiency of all-ops vs. state-vector synchronization

## Utils

- **utils/fuzzy-test-utils.ts**: Common utilities for fuzzy testing including random operation execution, tree creation, and synchronization methods

## Running Tests

```bash
# Run all tests
npm test

# Run specific test types
npm run test:basic
npm run test:fuzzy
npm run test:vector
npm run test:comparison

# Run tests in watch mode
npm run test:watch
```

## Test Parameters

The fuzzy tests use the following parameters:

- **treesCount**: Number of peer trees to create (default: 3)
- **rounds**: Number of rounds of random operations to perform (default: 5)
- **actionsPerRound**: Number of random actions per tree per round (default: 200-500)

These parameters can be adjusted to increase test coverage or reduce execution time.

## Metrics Tracked

For comparison tests, the following metrics are tracked:

1. **Execution Time**: Time taken to complete the synchronization
2. **Operations Transferred**: Total number of operations sent between trees
3. **Efficiency**: Percentage of unnecessary transfers avoided with state vectors
4. **Tree Size**: Number of vertices in the resulting trees

State vector synchronization typically shows 80-90% reduction in operations transferred compared to sending all operations. 