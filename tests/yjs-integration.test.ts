import { RepTree, isYjsDocument } from '../dist/index.js';
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
  const yjsDoc = tree.createYjsDocument('text');
  assert(isYjsDocument(yjsDoc), 'yjsDoc should be recognized as a Yjs document');
  
  // Set the document as a property
  // The document becomes a property value that can be replicated like any other property
  tree.setVertexProperty(rootId, 'content', yjsDoc);
  
  // Retrieve the property
  const retrievedProperty = tree.getVertexProperty(rootId, 'content');
  assert(isYjsDocument(retrievedProperty), 'Retrieved property should be a Yjs document');
  
  // Get the live Yjs document
  // This turns the serialized property into a live Yjs document we can edit
  // We need to pass vertex ID and key for caching purposes
  const liveDoc = tree.getYjsDocument(retrievedProperty!, rootId, 'content');
  assert(liveDoc !== undefined, 'Should be able to get a live Yjs document');
  
  // Get the text shared type
  const ytext = liveDoc!.getText('default');
  
  // Insert some text - this uses Yjs's built-in CRDT capabilities
  ytext.insert(0, 'Hello, collaborative world!');
  
  // Update the property - this converts the Yjs changes back into a RepTree property
  tree.updateYjsDocumentProperty(rootId, 'content', liveDoc!, 'text');
  
  // Retrieve the updated property
  const updatedProperty = tree.getVertexProperty(rootId, 'content');
  assert(isYjsDocument(updatedProperty), 'Updated property should be a Yjs document');
  
  // Get the updated live document
  const updatedLiveDoc = tree.getYjsDocument(updatedProperty!, rootId, 'content');
  const updatedYtext = updatedLiveDoc!.getText('default');
  
  // Check the text content
  assertEqual(updatedYtext.toString(), 'Hello, collaborative world!', 'Text content should be preserved');
  
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
  const yjsDoc = treeA.createYjsDocument('text');
  treeA.setVertexProperty(rootId, 'content', yjsDoc);
  
  // Modify the document
  const contentA = treeA.getVertexProperty(rootId, 'content');
  const liveDoc = treeA.getYjsDocument(contentA!, rootId, 'content');
  const ytext = liveDoc!.getText('default');
  
  // This change uses Yjs's CRDT mechanism internally
  ytext.insert(0, 'Hello from Tree A');
  
  // This converts the Yjs document to a RepTree property operation
  treeA.updateYjsDocumentProperty(rootId, 'content', liveDoc!, 'text');
  
  // Synchronize the trees using RepTree's operation-based sync
  const ops = treeA.getAllOps();
  treeB.merge(ops);
  
  // Check if the document was synchronized
  const retrievedProperty = treeB.getVertexProperty(rootId, 'content');
  assert(isYjsDocument(retrievedProperty), 'Retrieved property from treeB should be a Yjs document');
  
  // Get the live document from the second tree
  const liveBDoc = treeB.getYjsDocument(retrievedProperty!, rootId, 'content');
  const ytextB = liveBDoc!.getText('default');
  
  // Check the text content
  assertEqual(ytextB.toString(), 'Hello from Tree A', 'Text content should be synced between trees');
  
  // Make changes in the second tree
  ytextB.insert(ytextB.length, ' and Tree B');
  treeB.updateYjsDocumentProperty(rootId, 'content', liveBDoc!, 'text');
  
  // Sync back to the first tree
  const opsB = treeB.getAllOps();
  treeA.merge(opsB);
  
  // Check if the changes were synchronized back
  const finalProperty = treeA.getVertexProperty(rootId, 'content');
  const finalLiveDoc = treeA.getYjsDocument(finalProperty!, rootId, 'content');
  const finalYtext = finalLiveDoc!.getText('default');
  
  // Check the text content
  assertEqual(finalYtext.toString(), 'Hello from Tree A and Tree B', 'Bi-directional sync should work');
  
  console.log('✅ testYjsSynchronization passed!');
  return true;
}

// Test with Yjs map
function testYjsMap() {
  const tree = new RepTree('peer1');
  const rootId = tree.rootVertex.id;
  
  // Create a Yjs map document
  const yjsDoc = tree.createYjsDocument('map');
  tree.setVertexProperty(rootId, 'metadata', yjsDoc);
  
  // Get the live document
  const metadata = tree.getVertexProperty(rootId, 'metadata');
  const liveDoc = tree.getYjsDocument(metadata!, rootId, 'metadata');
  const ymap = liveDoc!.getMap('default');
  
  // Add some data to the map
  ymap.set('title', 'Collaborative Document');
  ymap.set('author', 'Test User');
  ymap.set('version', 1);
  
  // Update the property
  tree.updateYjsDocumentProperty(rootId, 'metadata', liveDoc!, 'map');
  
  // Retrieve the updated property
  const updatedProperty = tree.getVertexProperty(rootId, 'metadata');
  const updatedLiveDoc = tree.getYjsDocument(updatedProperty!, rootId, 'metadata');
  const updatedYmap = updatedLiveDoc!.getMap('default');
  
  // Check the map contents
  assertEqual(updatedYmap.get('title'), 'Collaborative Document', 'Map title should be preserved');
  assertEqual(updatedYmap.get('author'), 'Test User', 'Map author should be preserved');
  assertEqual(updatedYmap.get('version'), 1, 'Map version should be preserved');
  
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