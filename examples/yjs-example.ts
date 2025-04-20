import { RepTree, isYjsDocument } from '../dist/index.js';
import * as Y from 'yjs';

// Example for Yjs integration in RepTree
console.log('RepTree with Yjs Integration Example');
console.log('-----------------------------------');

// Create two RepTree instances (simulating two peers)
const tree1 = new RepTree('peer1');
const tree2 = new RepTree('peer2');

console.log('Created two RepTree instances: peer1 and peer2');

// Get root vertices
const rootId1 = tree1.rootVertex.id;
const rootId2 = tree2.rootVertex.id;

console.log(`Root vertex IDs: ${rootId1} (peer1), ${rootId2} (peer2)`);

// === Rich Text Example ===
console.log('\n1. Rich Text Example:');

// Create a collaborative text document in the first tree
console.log('Creating a Yjs text document in peer1...');
const textDoc = tree1.createYjsDocument('text');
tree1.setVertexProperty(rootId1, 'content', textDoc);

// Get the live Yjs document and make changes
const contentProp = tree1.getVertexProperty(rootId1, 'content');
const liveTextDoc = tree1.getYjsDocument(contentProp!, rootId1, 'content');
const ytext = liveTextDoc!.getText('default');
ytext.insert(0, 'Hello from peer1!');
tree1.updateYjsDocumentProperty(rootId1, 'content', liveTextDoc!, 'text');

console.log(`Text in peer1: "${ytext.toString()}"`);

// Sync from peer1 to peer2
console.log('\nSynchronizing from peer1 to peer2...');
const ops1 = tree1.getAllOps();
tree2.merge(ops1);

// Check the synchronized document in peer2
const syncedProperty = tree2.getVertexProperty(rootId2, 'content');
if (isYjsDocument(syncedProperty)) {
  const syncedDoc = tree2.getYjsDocument(syncedProperty, rootId2, 'content');
  const syncedText = syncedDoc!.getText('default');
  console.log(`Text in peer2 after sync: "${syncedText.toString()}"`);
  
  // Make additional changes in peer2
  console.log('\nMaking changes in peer2...');
  syncedText.insert(syncedText.length, ' And hello from peer2!');
  tree2.updateYjsDocumentProperty(rootId2, 'content', syncedDoc!, 'text');
  console.log(`Text in peer2: "${syncedText.toString()}"`);
  
  // Sync back to peer1
  console.log('\nSynchronizing back to peer1...');
  const ops2 = tree2.getAllOps();
  tree1.merge(ops2);
  
  // Check final state in peer1
  const finalProperty = tree1.getVertexProperty(rootId1, 'content');
  if (isYjsDocument(finalProperty)) {
    const finalDoc = tree1.getYjsDocument(finalProperty, rootId1, 'content');
    const finalText = finalDoc!.getText('default');
    console.log(`Final text in peer1: "${finalText.toString()}"`);
  }
}

// === Structured Data Example ===
console.log('\n2. Structured Data Example (Map):');

// Create a collaborative map in the first tree
console.log('Creating a Yjs map document in peer1...');
const mapDoc = tree1.createYjsDocument('map');
tree1.setVertexProperty(rootId1, 'metadata', mapDoc);

// Get the live Yjs document and add data
const metadataProp = tree1.getVertexProperty(rootId1, 'metadata');
const liveMapDoc = tree1.getYjsDocument(metadataProp!, rootId1, 'metadata');
const ymap = liveMapDoc!.getMap('default');

// Add some data to the map
ymap.set('title', 'Collaborative Document');
ymap.set('tags', ['crdt', 'yjs', 'reptree']);
ymap.set('created', new Date().toISOString());

tree1.updateYjsDocumentProperty(rootId1, 'metadata', liveMapDoc!, 'map');

console.log('Map data in peer1:');
console.log(`- title: ${ymap.get('title')}`);
console.log(`- tags: ${JSON.stringify(ymap.get('tags'))}`);
console.log(`- created: ${ymap.get('created')}`);

// Sync from peer1 to peer2
console.log('\nSynchronizing map from peer1 to peer2...');
const mapOps = tree1.getAllOps();
tree2.merge(mapOps);

// Check the synchronized map in peer2
const syncedMapProperty = tree2.getVertexProperty(rootId2, 'metadata');
if (isYjsDocument(syncedMapProperty)) {
  const syncedMapDoc = tree2.getYjsDocument(syncedMapProperty, rootId2, 'metadata');
  const syncedMap = syncedMapDoc!.getMap('default');
  
  console.log('Map data in peer2 after sync:');
  console.log(`- title: ${syncedMap.get('title')}`);
  console.log(`- tags: ${JSON.stringify(syncedMap.get('tags'))}`);
  console.log(`- created: ${syncedMap.get('created')}`);
  
  // Make additional changes in peer2
  console.log('\nUpdating map in peer2...');
  syncedMap.set('title', 'Updated Collaborative Document');
  syncedMap.set('updated', new Date().toISOString());
  syncedMap.set('editor', 'peer2');
  tree2.updateYjsDocumentProperty(rootId2, 'metadata', syncedMapDoc!, 'map');
  
  console.log('Updated map data in peer2:');
  console.log(`- title: ${syncedMap.get('title')}`);
  console.log(`- updated: ${syncedMap.get('updated')}`);
  console.log(`- editor: ${syncedMap.get('editor')}`);
  
  // Sync back to peer1
  console.log('\nSynchronizing back to peer1...');
  const updatedMapOps = tree2.getAllOps();
  tree1.merge(updatedMapOps);
  
  // Check final state in peer1
  const finalMapProperty = tree1.getVertexProperty(rootId1, 'metadata');
  if (isYjsDocument(finalMapProperty)) {
    const finalMapDoc = tree1.getYjsDocument(finalMapProperty, rootId1, 'metadata');
    const finalMap = finalMapDoc!.getMap('default');
    
    console.log('Final map data in peer1:');
    console.log(`- title: ${finalMap.get('title')}`);
    console.log(`- tags: ${JSON.stringify(finalMap.get('tags'))}`);
    console.log(`- created: ${finalMap.get('created')}`);
    console.log(`- updated: ${finalMap.get('updated')}`);
    console.log(`- editor: ${finalMap.get('editor')}`);
  }
}

console.log('\nExample completed!'); 