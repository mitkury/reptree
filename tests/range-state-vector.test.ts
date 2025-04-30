// Test suite for Range-Based State Vector functionality

import { RepTree } from "../src/RepTree";
import { strict as assert } from 'assert';

console.log("Running Range-Based State Vector tests...");

// Test case 1: Basic state vector generation and merging
function testBasicStateVector() {
  console.log("  Running testBasicStateVector...");
  const tree1 = new RepTree("peer1");
  const tree2 = new RepTree("peer2");

  // Operations on tree1
  const child1_1 = tree1.newVertex(tree1.rootVertexId);
  tree1.setVertexProperty(child1_1.id, "name", "Child 1.1");
  const child1_2 = tree1.newVertex(tree1.rootVertexId);
  tree1.setVertexProperty(child1_2.id, "name", "Child 1.2");

  // Operations on tree2
  const child2_1 = tree2.newVertex(tree2.rootVertexId);
  tree2.setVertexProperty(child2_1.id, "name", "Child 2.1");

  // Get state vectors
  const sv1 = tree1.getStateVector();
  const sv2 = tree2.getStateVector();

  // Check initial state vectors (peer1 should have ops 1-4, peer2 should have ops 1-2)
  // Note: Op counters start from 1. Root creation is op 1, void vertex is op 2.
  // Tree1: newVertex(root) -> op 3, setProp -> op 4, newVertex(root) -> op 5, setProp -> op 6
  // Tree2: newVertex(root) -> op 3, setProp -> op 4
  assert.deepStrictEqual(sv1["peer1"], [[1, 6]], "Test Failed: tree1 initial state vector for peer1");
  assert.deepStrictEqual(sv2["peer2"], [[1, 4]], "Test Failed: tree2 initial state vector for peer2");

  // Sync tree1 -> tree2
  const opsFor2 = tree1.getMissingOps(sv2);
  tree2.merge(opsFor2);
  const sv2_after_merge1 = tree2.getStateVector();

  // Check state vector of tree2 after merging ops from tree1
  assert.deepStrictEqual(sv2_after_merge1["peer1"], [[1, 6]], "Test Failed: tree2 state vector for peer1 after merge");
  assert.deepStrictEqual(sv2_after_merge1["peer2"], [[1, 4]], "Test Failed: tree2 state vector for peer2 after merge");

  // Sync tree2 -> tree1
  const opsFor1 = tree2.getMissingOps(sv1);
  tree1.merge(opsFor1);
  const sv1_after_merge2 = tree1.getStateVector();

  // Check state vector of tree1 after merging ops from tree2
  assert.deepStrictEqual(sv1_after_merge2["peer1"], [[1, 6]], "Test Failed: tree1 state vector for peer1 after merge");
  assert.deepStrictEqual(sv1_after_merge2["peer2"], [[1, 4]], "Test Failed: tree1 state vector for peer2 after merge");

  // Verify tree structures are identical after sync
  assert(tree1.compareStructure(tree2), "Test Failed: Tree structures should be identical after sync");

  console.log("  testBasicStateVector PASSED.");
}

// Test case 2: Non-contiguous ranges
function testNonContiguousRanges() {
  console.log("  Running testNonContiguousRanges...");
  const treeA = new RepTree("peerA");
  const treeB = new RepTree("peerB");

  // Ops on A: 1(root), 2(void), 3(vA1), 4(propA1), 5(vA2), 6(propA2)
  const vA1 = treeA.newVertex(treeA.rootVertexId); // Op 3
  treeA.setVertexProperty(vA1.id, "val", 1);      // Op 4
  const vA2 = treeA.newVertex(treeA.rootVertexId); // Op 5
  treeA.setVertexProperty(vA2.id, "val", 2);      // Op 6

  // Ops on B: 1(root), 2(void), 3(vB1), 4(propB1)
  const vB1 = treeB.newVertex(treeB.rootVertexId); // Op 3
  treeB.setVertexProperty(vB1.id, "val", 10);     // Op 4

  const opsA = treeA.getAllOps();
  const opsB = treeB.getAllOps();

  // Simulate partial sync: B gets ops 1, 2, 3, 4, 6 from A (missing 5)
  const opsA_subset = opsA.filter(op => op.id.counter !== 5);
  treeB.merge(opsA_subset);

  const svB_partial = treeB.getStateVector();
  // B should have [1,4], [6,6] for peerA and [1,4] for peerB
  assert.deepStrictEqual(svB_partial["peerA"], [[1, 4], [6, 6]], "Test Failed: treeB partial state vector for peerA");
  assert.deepStrictEqual(svB_partial["peerB"], [[1, 4]], "Test Failed: treeB partial state vector for peerB");

  // Now A asks B for missing ops
  const svA = treeA.getStateVector();
  const missingOpsForA = treeB.getMissingOps(svA);

  // A should only need ops 3, 4 from peerB
  assert.strictEqual(missingOpsForA.length, 2, "Test Failed: A should need 2 ops from B");
  assert(missingOpsForA.every(op => op.id.peerId === "peerB"), "Test Failed: Missing ops for A should be from peerB");
  assert(missingOpsForA.find(op => op.id.counter === 3), "Test Failed: Missing ops for A should include counter 3 from B");
  assert(missingOpsForA.find(op => op.id.counter === 4), "Test Failed: Missing ops for A should include counter 4 from B");

  // B asks A for missing ops
  const missingOpsForB = treeA.getMissingOps(svB_partial);

  // B should only need op 5 from peerA
  assert.strictEqual(missingOpsForB.length, 1, "Test Failed: B should need 1 op from A");
  assert.strictEqual(missingOpsForB[0].id.peerId, "peerA", "Test Failed: Missing op for B should be from peerA");
  assert.strictEqual(missingOpsForB[0].id.counter, 5, "Test Failed: Missing op for B should be counter 5");

  // Merge remaining ops
  treeA.merge(missingOpsForA);
  treeB.merge(missingOpsForB);

  // Verify final state vectors
  const svA_final = treeA.getStateVector();
  const svB_final = treeB.getStateVector();
  assert.deepStrictEqual(svA_final["peerA"], [[1, 6]], "Test Failed: treeA final state vector for peerA");
  assert.deepStrictEqual(svA_final["peerB"], [[1, 4]], "Test Failed: treeA final state vector for peerB");
  assert.deepStrictEqual(svB_final["peerA"], [[1, 6]], "Test Failed: treeB final state vector for peerA");
  assert.deepStrictEqual(svB_final["peerB"], [[1, 4]], "Test Failed: treeB final state vector for peerB");

  // Verify tree structures are identical
  assert(treeA.compareStructure(treeB), "Test Failed: Tree structures should be identical after full sync");

  console.log("  testNonContiguousRanges PASSED.");
}

// Run tests
testBasicStateVector();
testNonContiguousRanges();

console.log("Range-Based State Vector tests completed successfully.");

