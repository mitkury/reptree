import { RepTree } from '../dist/index.js';
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
console.log('Creating a Y.Doc text document in peer1...');
const textDoc = new Y.Doc();
const ytext = textDoc.getText('default');
tree1.setVertexProperty(rootId1, 'content', textDoc as any);

// Add text content
ytext.insert(0, 'Hello from peer1!');
console.log(`Text in peer1: "${ytext.toString()}"`);

// Sync from peer1 to peer2
console.log('\nSynchronizing from peer1 to peer2...');
const ops1 = tree1.getAllOps();
console.log(`Got ${ops1.length} operations from tree1`);

// Debug: Print operation types
console.log('Operation types:');
for (const op of ops1) {
  if ('parentId' in op) {
    console.log(` - MoveVertex: target=${op.targetId}, parent=${op.parentId}`);
  } else if ('key' in op && 'transient' in op) {
    console.log(` - SetVertexProperty: target=${op.targetId}, key=${op.key}, valueType=${typeof op.value}`);
    if (typeof op.value === 'object' && op.value !== null) {
      console.log(`   - Value details: ${JSON.stringify(op.value)}`);
    }
  } else if ('key' in op && !('transient' in op)) {
    console.log(` - YjsUpdate: target=${op.targetId}, key=${op.key}`);
    const val = op.value as any;
    if (val && val._type) {
      console.log(`   - Update type: ${val._type}`);
    }
  }
}

tree2.merge(ops1);

// Debug: Check what properties exist in tree2
console.log('\nDebugging tree2 properties:');
const props = tree2.getVertexProperties(rootId2);
console.log('Properties:', props);

// Check the synchronized document in peer2
const syncedProp = tree2.getVertexProperty(rootId2, 'content');
console.log('Synced property type:', syncedProp ? typeof syncedProp : 'undefined');
console.log('Property is Y.Doc?', syncedProp instanceof Y.Doc);

if (syncedProp) {
  const syncedTextDoc = syncedProp as any as Y.Doc;
  const syncedText = syncedTextDoc.getText('default');
  console.log(`Text in peer2 after sync: "${syncedText.toString()}"`);
  
  // Make additional changes in peer2
  console.log('\nMaking changes in peer2...');
  syncedText.insert(syncedText.length, ' And hello from peer2!');
  console.log(`Text in peer2: "${syncedText.toString()}"`);
  
  // Sync back to peer1
  console.log('\nSynchronizing back to peer1...');
  const ops2 = tree2.getAllOps();
  tree1.merge(ops2);
  
  // Check final state in peer1
  const finalTextDoc = tree1.getVertexProperty(rootId1, 'content') as any as Y.Doc;
  const finalText = finalTextDoc.getText('default');
  console.log(`Final text in peer1: "${finalText.toString()}"`);
} else {
  console.error('Failed to get syncedProp in tree2');
}

// === Structured Data Example ===
console.log('\n2. Structured Data Example (Map):');

// Create a collaborative map in the first tree
console.log('Creating a Y.Doc map document in peer1...');
const mapDoc = new Y.Doc();
const ymap = mapDoc.getMap('default');
tree1.setVertexProperty(rootId1, 'metadata', mapDoc as any);

// Add some data to the map
ymap.set('title', 'Collaborative Document');
ymap.set('tags', ['crdt', 'yjs', 'reptree']);
ymap.set('created', new Date().toISOString());

console.log('Map data in peer1:');
console.log(`- title: ${ymap.get('title')}`);
console.log(`- tags: ${JSON.stringify(ymap.get('tags'))}`);
console.log(`- created: ${ymap.get('created')}`);

// Sync from peer1 to peer2
console.log('\nSynchronizing map from peer1 to peer2...');
const mapOps = tree1.getAllOps();
tree2.merge(mapOps);

// Check the synchronized map in peer2
const syncedMapDoc = tree2.getVertexProperty(rootId2, 'metadata') as any as Y.Doc;
const syncedMap = syncedMapDoc.getMap('default');

console.log('Map data in peer2 after sync:');
console.log(`- title: ${syncedMap.get('title')}`);
console.log(`- tags: ${JSON.stringify(syncedMap.get('tags'))}`);
console.log(`- created: ${syncedMap.get('created')}`);

// Make additional changes in peer2
console.log('\nUpdating map in peer2...');
syncedMap.set('title', 'Updated Collaborative Document');
syncedMap.set('updated', new Date().toISOString());
syncedMap.set('editor', 'peer2');

console.log('Updated map data in peer2:');
console.log(`- title: ${syncedMap.get('title')}`);
console.log(`- updated: ${syncedMap.get('updated')}`);
console.log(`- editor: ${syncedMap.get('editor')}`);

// Sync back to peer1
console.log('\nSynchronizing back to peer1...');
const updatedMapOps = tree2.getAllOps();
tree1.merge(updatedMapOps);

// Check final state in peer1
const finalMapDoc = tree1.getVertexProperty(rootId1, 'metadata') as any as Y.Doc;
const finalMap = finalMapDoc.getMap('default');

console.log('Final map data in peer1:');
console.log(`- title: ${finalMap.get('title')}`);
console.log(`- tags: ${JSON.stringify(finalMap.get('tags'))}`);
console.log(`- created: ${finalMap.get('created')}`);
console.log(`- updated: ${finalMap.get('updated')}`);
console.log(`- editor: ${finalMap.get('editor')}`);

console.log('\nExample completed!'); 