import { RepTree } from '../src';
import * as Y from 'yjs';
import { describe, test, expect } from 'vitest';

describe('Yjs Properties', () => {
  test('Basic Yjs document property', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    
    // Create a Yjs document
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('default');
    ytext.insert(0, 'Hello world');
    
    // Set it as a property
    tree.setVertexProperty(root.id, 'content', ydoc);
    
    // Retrieve and verify
    const retrievedDoc = tree.getVertexProperty(root.id, 'content') as Y.Doc;
    expect(retrievedDoc).toBeInstanceOf(Y.Doc);
    expect(retrievedDoc.getText('default').toString()).toBe('Hello world');
  });
  
  test('Collaborative editing between two trees', () => {
    // Create two trees
    const tree1 = new RepTree('peer1');
    const root1 = tree1.createRoot();
    
    const tree2 = new RepTree('peer2');
    tree2.merge(tree1.getAllOps());
    const root2 = tree2.root!;
    
    // Create a Yjs document in tree1
    const ydoc1 = new Y.Doc();
    const ytext1 = ydoc1.getText('default');
    ytext1.insert(0, 'Hello ');
    tree1.setVertexProperty(root1.id, 'content', ydoc1);
    
    // Sync operations to tree2
    tree2.merge(tree1.popLocalOps());
    
    // Get the document in tree2 and make changes
    const ydoc2 = tree2.getVertexProperty(root2.id, 'content') as Y.Doc;
    const ytext2 = ydoc2.getText('default');
    ytext2.insert(ytext2.length, 'world!');
    
    // Sync back to tree1
    tree1.merge(tree2.popLocalOps());
    
    // Verify both documents have the same content
    const finalDoc1 = tree1.getVertexProperty(root1.id, 'content') as Y.Doc;
    const finalDoc2 = tree2.getVertexProperty(root2.id, 'content') as Y.Doc;
    
    expect(finalDoc1.getText('default').toString()).toBe('Hello world!');
    expect(finalDoc2.getText('default').toString()).toBe('Hello world!');
  });
  
  test('Concurrent editing with Yjs documents', () => {
    // Create two trees
    const tree1 = new RepTree('peer1');
    const root1 = tree1.createRoot();
    
    const tree2 = new RepTree('peer2');
    tree2.merge(tree1.getAllOps());
    const root2 = tree2.root!;
    
    // Create a Yjs document in tree1
    const ydoc1 = new Y.Doc();
    const ytext1 = ydoc1.getText('default');
    ytext1.insert(0, 'Base text');
    tree1.setVertexProperty(root1.id, 'content', ydoc1);
    
    // Sync operations to tree2
    tree2.merge(tree1.popLocalOps());
    
    // Make concurrent changes in both trees
    const ydoc2 = tree2.getVertexProperty(root2.id, 'content') as Y.Doc;
    const ytext2 = ydoc2.getText('default');
    
    // Tree1 adds at the beginning
    ytext1.insert(0, 'Start: ');
    
    // Tree2 adds at the end
    ytext2.insert(ytext2.length, ' End');
    
    // Sync both ways
    tree1.merge(tree2.popLocalOps());
    tree2.merge(tree1.popLocalOps());
    
    // Verify both documents have the same content with both changes
    const finalDoc1 = tree1.getVertexProperty(root1.id, 'content') as Y.Doc;
    const finalDoc2 = tree2.getVertexProperty(root2.id, 'content') as Y.Doc;
    
    const expectedText = 'Start: Base text End';
    expect(finalDoc1.getText('default').toString()).toBe(expectedText);
    expect(finalDoc2.getText('default').toString()).toBe(expectedText);
  });
  
  test('Complex Yjs document with multiple shared types', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    
    // Create a complex Yjs document with multiple shared types
    const ydoc = new Y.Doc();
    
    // Add a text
    const ytext = ydoc.getText('text');
    ytext.insert(0, 'Hello world');
    
    // Add an array
    const yarray = ydoc.getArray('array');
    yarray.push(['item1', 'item2', 'item3']);
    
    // Add a map
    const ymap = ydoc.getMap('map');
    ymap.set('key1', 'value1');
    ymap.set('key2', 'value2');
    
    // Set as property
    tree.setVertexProperty(root.id, 'document', ydoc);
    
    // Retrieve and verify
    const retrievedDoc = tree.getVertexProperty(root.id, 'document') as Y.Doc;
    
    // Check text
    expect(retrievedDoc.getText('text').toString()).toBe('Hello world');
    
    // Check array
    const retrievedArray = retrievedDoc.getArray('array');
    expect(retrievedArray.toArray()).toEqual(['item1', 'item2', 'item3']);
    
    // Check map
    const retrievedMap = retrievedDoc.getMap('map');
    expect(retrievedMap.get('key1')).toBe('value1');
    expect(retrievedMap.get('key2')).toBe('value2');
  });
});
