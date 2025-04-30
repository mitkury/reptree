import { fuzzyTest } from "./fuzzyTests.js";
import { RepTree } from "../dist/index.js";
import { strict as assert } from 'assert';

console.log("🔄 Comparing Synchronization Methods Test");

// Simple seeded random number generator for consistent tests
class SeededRandom {
  private seed: number;

  constructor(seed: number = 42) {
    this.seed = seed;
  }

  // Return a random float between 0 and 1
  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  // Return a random integer between min (inclusive) and max (exclusive)
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }
}

let rng = new SeededRandom(42); // Use a fixed seed for reproducibility

// Run the original fuzzy test with immediate sync
function testImmediateSync() {
  console.log("\n🧪 Testing with IMMEDIATE synchronization:");
  
  // Reset the RNG before starting this test
  rng = new SeededRandom(42);
  
  // Override the fuzzyTest function to use immediate sync
  const trees = runFuzzyTest((trees, maxMoves) => {
    const treeCount = trees.length;
    console.log(`Executing ${maxMoves} actions with immediate sync after each action`);
    
    let operationsMade = 0;
    
    for (let i = 0; i < maxMoves; i++) {
      // Pick a random tree to make a change
      const treeIndex = rng.nextInt(0, treeCount);
      const tree = trees[treeIndex];
      
      // Execute a random action
      executeRandomAction(tree);
      operationsMade++;
      
      // Sync the change to other trees immediately
      const ops = tree.getAllOps();
      for (let j = 0; j < treeCount; j++) {
        if (j !== treeIndex) {
          trees[j].merge(ops);
        }
      }
      
      if (i % 100 === 0 && i > 0) {
        console.log(`  Completed ${i} actions (${Math.round((i/maxMoves)*100)}%)`);
      }
    }
    
    console.log(`  Completed ${operationsMade} actions with immediate sync`);
  });
  
  return trees;
}

// Run the fuzzy test with delayed/batched sync
function testDelayedSync() {
  console.log("\n🧪 Testing with DELAYED/BATCHED synchronization:");
  
  // Reset the RNG before starting this test
  rng = new SeededRandom(42);
  
  const trees = runFuzzyTest((trees, maxMoves) => {
    const treeCount = trees.length;
    const actionsPerBatch = Math.max(10, Math.floor(maxMoves / 10)); // Split into ~10 batches
    const batches = Math.ceil(maxMoves / actionsPerBatch);
    
    console.log(`Executing ${maxMoves} actions in ${batches} batches (${actionsPerBatch} actions per batch)`);
    
    let totalOperationsMade = 0;
    
    for (let batch = 0; batch < batches; batch++) {
      console.log(`  Batch ${batch + 1}/${batches}: Executing random actions...`);
      const actualBatchSize = Math.min(actionsPerBatch, maxMoves - (batch * actionsPerBatch));
      
      let batchOperationsMade = 0;
      
      // Each tree performs actions independently
      for (let treeIndex = 0; treeIndex < treeCount; treeIndex++) {
        const tree = trees[treeIndex];
        const actionsThisBatch = Math.ceil(actualBatchSize / treeCount);
        
        for (let i = 0; i < actionsThisBatch; i++) {
          // Execute a random action
          executeRandomAction(tree);
          batchOperationsMade++;
        }
      }
      
      totalOperationsMade += batchOperationsMade;
      console.log(`    Executed ${batchOperationsMade} operations in batch ${batch + 1}`);
      
      // After all trees have performed their actions, sync them
      console.log(`  Batch ${batch + 1}/${batches}: Synchronizing trees...`);
      synchronizeTrees(trees);
    }
    
    console.log(`  Completed ${totalOperationsMade} actions with delayed sync`);
  });
  
  return trees;
}

// Helper function to run a fuzzy test with a specific sync strategy
function runFuzzyTest(syncStrategy: (trees: RepTree[], maxMoves: number) => void, 
                       treesCount = 3, 
                       tries = 1, 
                       movesPerTry = 1000): RepTree[] {
  if (treesCount < 2) {
    throw new Error("treesCount must be at least 2");
  }

  const trees: RepTree[] = [];

  trees[0] = new RepTree("peer1");
  for (let i = 1; i < treesCount; i++) {
    trees[i] = new RepTree(`peer${i + 1}`, trees[0].getMoveOps());
  }

  console.log(`Creating ${treesCount} trees and running ${tries} rounds with ${movesPerTry} actions per round`);

  for (let i = 0; i < tries; i++) {
    console.log(`Round ${i + 1}/${tries}...`);

    // Apply the provided sync strategy
    syncStrategy(trees, movesPerTry);

    // Check if all trees have the same structure
    console.log(`Verifying trees have the same structure...`);
    for (let j = 1; j < treesCount; j++) {
      if (!trees[0].compareStructure(trees[j])) {
        console.error(`❌ Tree ${j + 1} has a different structure from Tree 1`);
        
        // Collect diagnostic information
        const tree1Count = trees[0].getAllVertices().length;
        const tree2Count = trees[j].getAllVertices().length;
        console.error(`Vertex count: Tree 1 has ${tree1Count}, Tree ${j+1} has ${tree2Count}`);
        
        console.error(`\nDiagnostic information for Tree 1:`);
        console.log(trees[0].printTree());
        
        console.error(`\nDiagnostic information for Tree ${j+1}:`);
        console.log(trees[j].printTree());
        
        return trees;
      }
    }
    console.log(`✅ All trees have the same structure after round ${i + 1}`);
  }

  console.log(`🏁 All trees synced successfully after ${tries} rounds`);

  return trees;
}

// Function to synchronize all trees
function synchronizeTrees(trees: RepTree[]): void {
  const treeCount = trees.length;
  
  // For each tree, get ops and apply to all other trees
  for (let i = 0; i < treeCount; i++) {
    const sourceTree = trees[i];
    const ops = sourceTree.getAllOps();
    
    for (let j = 0; j < treeCount; j++) {
      if (i !== j) {
        trees[j].merge(ops);
      }
    }
  }
}

// Execute a random action on the given tree
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
      const parentIndex = rng.nextInt(0, vertices.length);
      tree.newVertex(vertices[parentIndex].id);
      break;
    
    case 'move':
      // Need non-root vertices to move
      if (nonRootVertices.length < 1) {
        // If no non-root vertices, just create a new vertex
        tree.newVertex(tree.rootVertexId);
      } else {
        // Pick a vertex to move (not the root)
        const moveIndex = rng.nextInt(0, nonRootVertices.length);
        const vertexToMove = nonRootVertices[moveIndex];
        
        // Pick a target vertex to move to (could be any vertex except the one we're moving)
        const possibleTargets = vertices.filter(v => v.id !== vertexToMove.id);
        const targetIndex = rng.nextInt(0, possibleTargets.length);
        const targetVertex = possibleTargets[targetIndex];
        
        // Skip move if it would create a cycle
        if (!tree.isAncestor(targetVertex.id, vertexToMove.id)) {
          tree.moveVertex(vertexToMove.id, targetVertex.id);
        }
      }
      break;
    
    case 'setProperty':
      // Can set property on any vertex
      const vertexIndex = rng.nextInt(0, vertices.length);
      const vertex = vertices[vertexIndex];
      
      const propName = `prop_${rng.nextInt(0, 10)}`;
      const propValue = `value_${rng.nextInt(0, 100)}`;
      
      tree.setVertexProperty(vertex.id, propName, propValue);
      break;
  }
}

// Pick a random action type
function pickRandomAction(): 'move' | 'create' | 'setProperty' {
  const actions = ['move', 'create', 'setProperty'];
  const index = rng.nextInt(0, actions.length);
  return actions[index] as 'move' | 'create' | 'setProperty';
}

// Run tests with limited operations for safety
console.log("\n🧪 Running comparison tests with smaller parameters for safety");
console.log("----------------------------------------------------------------");

// Run with small parameters first
const treeCount = 3;
const rounds = 3;
const actionsPerRound = 200;

try {
  console.log(`\nTest Parameters: ${treeCount} trees, ${rounds} rounds, ${actionsPerRound} actions per round`);
  
  const startImmediate = Date.now();
  const immediateTrees = testImmediateSync();
  const immediateTime = Date.now() - startImmediate;
  
  const startDelayed = Date.now();
  const delayedTrees = testDelayedSync();
  const delayedTime = Date.now() - startDelayed;
  
  console.log("\n📊 Results:");
  console.log(`  Immediate sync took: ${immediateTime}ms`);
  console.log(`  Delayed sync took: ${delayedTime}ms`);
  
  // Compare trees from both methods
  const treesAreEqual = immediateTrees[0].compareStructure(delayedTrees[0]);
  console.log(`  Trees from both methods are ${treesAreEqual ? 'identical ✅' : 'different ❌'}`);
  
  // Add diagnostic information when trees are different
  if (!treesAreEqual) {
    console.log("\n🔍 DIAGNOSTIC INFORMATION FOR DIFFERENT TREES:");
    
    // Compare vertex counts
    const tree1Count = immediateTrees[0].getAllVertices().length;
    const tree2Count = delayedTrees[0].getAllVertices().length;
    console.log(`Vertex counts: Immediate tree has ${tree1Count}, Delayed tree has ${tree2Count} vertices`);
    
    // Compare vertices structure
    const immediateVertexIds = new Set(immediateTrees[0].getAllVertices().map(v => v.id));
    const delayedVertexIds = new Set(delayedTrees[0].getAllVertices().map(v => v.id));
    
    const onlyInImmediate = [...immediateVertexIds].filter(id => !delayedVertexIds.has(id));
    const onlyInDelayed = [...delayedVertexIds].filter(id => !immediateVertexIds.has(id));
    
    if (onlyInImmediate.length > 0) {
      console.log(`Vertices only in Immediate: ${onlyInImmediate.length} (first 5: ${onlyInImmediate.slice(0, 5).join(', ')})`);
    }
    
    if (onlyInDelayed.length > 0) {
      console.log(`Vertices only in Delayed: ${onlyInDelayed.length} (first 5: ${onlyInDelayed.slice(0, 5).join(', ')})`);
    }
    
    // If same vertices but different structure, check parent relationships
    if (onlyInImmediate.length === 0 && onlyInDelayed.length === 0) {
      console.log(`Trees have identical vertices but different structure. Checking parent relationships...`);
      
      const sampleSize = Math.min(10, immediateVertexIds.size);
      const sampleVertices = [...immediateVertexIds].slice(0, sampleSize);
      
      for (const vertexId of sampleVertices) {
        const parent1 = immediateTrees[0].getParent(vertexId)?.id;
        const parent2 = delayedTrees[0].getParent(vertexId)?.id;
        
        if (parent1 !== parent2) {
          console.log(`Vertex ${vertexId} has different parents: Immediate: ${parent1}, Delayed: ${parent2}`);
        }
      }
    }
    
    // Show example structure for a few vertices
    const sharedVertices = [...immediateVertexIds].filter(id => delayedVertexIds.has(id));
    const sampleSize = Math.min(5, sharedVertices.length);
    const sampleVertices = sharedVertices.slice(0, sampleSize);
    
    for (const vertexId of sampleVertices) {
      console.log(`\nVertex ${vertexId} comparison:`);
      console.log(`  Immediate tree properties:`, immediateTrees[0].getVertexProperties(vertexId));
      console.log(`  Delayed tree properties:`, delayedTrees[0].getVertexProperties(vertexId));
      
      const immediateChildren = immediateTrees[0].getChildrenIds(vertexId);
      const delayedChildren = delayedTrees[0].getChildrenIds(vertexId);
      
      console.log(`  Immediate tree children: ${immediateChildren.length} (${immediateChildren.slice(0, 3).join(', ')}${immediateChildren.length > 3 ? '...' : ''})`);
      console.log(`  Delayed tree children: ${delayedChildren.length} (${delayedChildren.slice(0, 3).join(', ')}${delayedChildren.length > 3 ? '...' : ''})`);
    }
    
    // Output first few levels of both trees for visual comparison
    console.log(`\nImmediate Tree (first few levels):`);
    console.log(immediateTrees[0].printTree().split('\n').slice(0, 20).join('\n'));
    
    console.log(`\nDelayed Tree (first few levels):`);
    console.log(delayedTrees[0].printTree().split('\n').slice(0, 20).join('\n'));
  }
  
  console.log("\n🏁 Comparison test completed successfully!");
} catch (error) {
  console.error("❌ Test failed with error:", error);
}

// To run this test:
// npm run build && node --loader ts-node/esm tests/compare-sync-methods.ts 