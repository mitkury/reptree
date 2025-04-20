import { RepTree } from '../dist/index.js';
import * as Y from 'yjs';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Test failed: ${message}`);
  }
}

function assertEqual(actual: any, expected: any, message: string) {
  if (actual !== expected) {
    throw new Error(`Test failed: ${message}. Expected ${expected}, got ${actual}`);
  }
}

// Basic test for Yjs text document integration
function testYjsTextDocument() {
  // Create a RepTree instance with a peer ID
  const tree = new RepTree('peer1');
  const rootId = tree.rootVertex.id;
  
  // Create a Yjs text document
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('default');
  
  // Set the document as a property
  tree.setVertexProperty(rootId, 'content', ydoc as any);
  
  // Retrieve the property and cast it to Y.Doc
  const retrievedDoc = tree.getVertexProperty(rootId, 'content') as any as Y.Doc;
  assert(retrievedDoc instanceof Y.Doc, 'Retrieved property should be a Y.Doc instance');
  
  // Get the text shared type directly
  const retrievedText = retrievedDoc.getText('default');
  
  // Insert some text - this uses Yjs's built-in CRDT capabilities
  retrievedText.insert(0, 'Hello, collaborative world!');
  
  // No need to update the property - changes to the Y.Doc are live
  
  // Check the text content
  assertEqual(retrievedText.toString(), 'Hello, collaborative world!', 'Text content should be preserved');
  
  console.log('✅ testYjsTextDocument passed!');
  return true;
}

// Test synchronization between two trees
function testYjsSynchronization() {
  // Create two trees with the same operations to ensure they have the same root
  const baseTree = new RepTree('initial');
  const rootOps = baseTree.getAllOps();
  const treeA = new RepTree('peer1', rootOps);
  const treeB = new RepTree('peer2', rootOps);
  
  const rootId = treeA.rootVertex.id;
  assert(rootId === treeB.rootVertex.id, 'Root IDs should match for initialized trees');
  
  // Create a Yjs text document in the first tree
  const docA = new Y.Doc();
  const ytextA = docA.getText('default');
  treeA.setVertexProperty(rootId, 'content', docA as any);
  
  // Modify the document
  ytextA.insert(0, 'Hello from Tree A');
  
  // Synchronize the trees using RepTree's operation-based sync
  const ops = treeA.getAllOps();
  treeB.merge(ops);
  
  // Check if the document was synchronized
  const docB = treeB.getVertexProperty(rootId, 'content') as any as Y.Doc;
  assert(docB instanceof Y.Doc, 'Retrieved property from treeB should be a Y.Doc instance');
  
  // Get the text shared type from the second tree
  const ytextB = docB.getText('default');
  
  // Check the text content
  assertEqual(ytextB.toString(), 'Hello from Tree A', 'Text content should be synced between trees');
  
  // Make changes in the second tree
  ytextB.insert(ytextB.length, ' and Tree B');
  
  // Sync back to the first tree
  const opsB = treeB.getAllOps();
  treeA.merge(opsB);
  
  // Check if the changes were synchronized back
  const finalDoc = treeA.getVertexProperty(rootId, 'content') as any as Y.Doc;
  const finalText = finalDoc.getText('default');
  
  // Check the text content
  assertEqual(finalText.toString(), 'Hello from Tree A and Tree B', 'Bi-directional sync should work');
  
  console.log('✅ testYjsSynchronization passed!');
  return true;
}

// Test with Yjs map
function testYjsMap() {
  const tree = new RepTree('peer1');
  const rootId = tree.rootVertex.id;
  
  // Create a Yjs map document
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap('default');
  tree.setVertexProperty(rootId, 'metadata', ydoc as any);
  
  // Add some data to the map
  ymap.set('title', 'Collaborative Document');
  ymap.set('author', 'Test User');
  ymap.set('version', 1);
  
  // Retrieve the property (should be the same instance)
  const retrievedDoc = tree.getVertexProperty(rootId, 'metadata') as any as Y.Doc;
  const retrievedMap = retrievedDoc.getMap('default');
  
  // Check the map contents
  assertEqual(retrievedMap.get('title'), 'Collaborative Document', 'Map title should be preserved');
  assertEqual(retrievedMap.get('author'), 'Test User', 'Map author should be preserved');
  assertEqual(retrievedMap.get('version'), 1, 'Map version should be preserved');
  
  console.log('✅ testYjsMap passed!');
  return true;
}

// Run all tests
function runTests() {
  console.log('Running Yjs integration tests...');
  
  let allTestsPassed = true;
  
  try {
    testYjsTextDocument();
    testYjsSynchronization();
    testYjsMap();
    
    console.log('\n🎉 All Yjs integration tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    allTestsPassed = false;
  }
  
  return allTestsPassed;
}

// Run the tests
runTests(); 