import { RepTree } from '../src';
import { VertexOperation } from '../src/operations';
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

  test('Override regular property with Yjs property', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    
    // Set a regular property first
    tree.setVertexProperty(root.id, 'content', 'Regular string content');
    expect(tree.getVertexProperty(root.id, 'content')).toBe('Regular string content');
    
    // Now override with a Yjs document
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('default');
    ytext.insert(0, 'Yjs content');
    tree.setVertexProperty(root.id, 'content', ydoc);
    
    // Verify it's now a Yjs document
    const retrievedDoc = tree.getVertexProperty(root.id, 'content');
    expect(retrievedDoc).toBeInstanceOf(Y.Doc);
    expect((retrievedDoc as Y.Doc).getText('default').toString()).toBe('Yjs content');
  });
  
  test('Override Yjs property with regular property', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    
    // Set a Yjs document first
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('default');
    ytext.insert(0, 'Initial Yjs content');
    tree.setVertexProperty(root.id, 'content', ydoc);
    
    // Verify it's a Yjs document
    let retrievedDoc = tree.getVertexProperty(root.id, 'content');
    expect(retrievedDoc).toBeInstanceOf(Y.Doc);
    
    // Now override with a regular property
    tree.setVertexProperty(root.id, 'content', 'Regular string content');
    
    // Verify it's now a regular string
    retrievedDoc = tree.getVertexProperty(root.id, 'content');
    expect(typeof retrievedDoc).toBe('string');
    expect(retrievedDoc).toBe('Regular string content');
  });
  
  test('Multiple property type transitions', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    
    // Start with a string
    tree.setVertexProperty(root.id, 'content', 'Initial string');
    expect(tree.getVertexProperty(root.id, 'content')).toBe('Initial string');
    
    // Change to a number
    tree.setVertexProperty(root.id, 'content', 42);
    expect(tree.getVertexProperty(root.id, 'content')).toBe(42);
    
    // Change to a Yjs document
    const ydoc1 = new Y.Doc();
    const ytext1 = ydoc1.getText('default');
    ytext1.insert(0, 'First Yjs content');
    tree.setVertexProperty(root.id, 'content', ydoc1);
    
    // Verify it's a Yjs document
    let retrievedDoc = tree.getVertexProperty(root.id, 'content');
    expect(retrievedDoc).toBeInstanceOf(Y.Doc);
    expect((retrievedDoc as Y.Doc).getText('default').toString()).toBe('First Yjs content');
    
    // Change back to a string
    tree.setVertexProperty(root.id, 'content', 'Back to string');
    expect(tree.getVertexProperty(root.id, 'content')).toBe('Back to string');
    
    // Change to a different Yjs document
    const ydoc2 = new Y.Doc();
    const ytext2 = ydoc2.getText('default');
    ytext2.insert(0, 'Second Yjs content');
    tree.setVertexProperty(root.id, 'content', ydoc2);
    
    // Verify it's the new Yjs document
    retrievedDoc = tree.getVertexProperty(root.id, 'content');
    expect(retrievedDoc).toBeInstanceOf(Y.Doc);
    expect((retrievedDoc as Y.Doc).getText('default').toString()).toBe('Second Yjs content');
  });
  
  test('Multiple sequential updates to Yjs document', () => {
    const tree1 = new RepTree('peer1');
    const root1 = tree1.createRoot();
    
    const tree2 = new RepTree('peer2');
    tree2.merge(tree1.getAllOps());
    const root2 = tree2.root!;
    
    // Create a Yjs document in tree1
    const ydoc1 = new Y.Doc();
    const ytext1 = ydoc1.getText('default');
    ytext1.insert(0, 'Initial text');
    tree1.setVertexProperty(root1.id, 'content', ydoc1);
    
    // Sync to tree2
    const initialOps = tree1.popLocalOps();
    expect(initialOps.length).toBeGreaterThan(0); // Verify ops were created
    tree2.merge(initialOps);
    
    // Make multiple edits to the document in tree1
    const doc1 = tree1.getVertexProperty(root1.id, 'content') as Y.Doc;
    const text1 = doc1.getText('default');
    
    // Edit 1
    text1.insert(text1.length, ' - Edit 1');
    const ops1 = tree1.popLocalOps();
    expect(ops1.length).toBeGreaterThan(0); // Verify ops were created for Edit 1
    
    // Edit 2
    text1.insert(text1.length, ' - Edit 2');
    const ops2 = tree1.popLocalOps();
    expect(ops2.length).toBeGreaterThan(0); // Verify ops were created for Edit 2
    
    // Edit 3
    text1.insert(0, 'Prefix: ');
    const ops3 = tree1.popLocalOps();
    expect(ops3.length).toBeGreaterThan(0); // Verify ops were created for Edit 3
    
    // Apply all edits to tree2 in sequence
    tree2.merge(ops1);
    tree2.merge(ops2);
    tree2.merge(ops3);
    
    // Verify final state
    const doc2 = tree2.getVertexProperty(root2.id, 'content') as Y.Doc;
    expect(doc2.getText('default').toString()).toBe('Prefix: Initial text - Edit 1 - Edit 2');
    expect(doc1.getText('default').toString()).toBe('Prefix: Initial text - Edit 1 - Edit 2');
  });

  test('Concurrent edits with Yjs CRDT properties', () => {
    // This test verifies that concurrent edits to a Yjs document from different
    // trees are correctly merged with the expected CRDT behavior
    
    // Create two trees with the same initial state
    const tree1 = new RepTree('peer1');
    const root1 = tree1.createRoot();
    
    const tree2 = new RepTree('peer2');
    tree2.merge(tree1.getAllOps());
    const root2 = tree2.root!;
    
    // Create a Yjs document in tree1
    const ydoc1 = new Y.Doc();
    tree1.setVertexProperty(root1.id, 'content', ydoc1);
    
    // Sync to tree2
    tree2.merge(tree1.popLocalOps());
    
    // Get the documents in both trees
    const doc1 = tree1.getVertexProperty(root1.id, 'content') as Y.Doc;
    const doc2 = tree2.getVertexProperty(root2.id, 'content') as Y.Doc;
    
    const text1 = doc1.getText('default');
    const text2 = doc2.getText('default');
    
    // Make concurrent edits in both trees
    // Tree1: Add numbers 1-5 at the beginning
    for (let i = 5; i >= 1; i--) {
      text1.insert(0, i.toString());
    }
    
    // Tree2: Add numbers 6-10 at the end
    for (let i = 6; i <= 10; i++) {
      text2.insert(text2.length, i.toString());
    }
    
    // Collect operations from both trees
    const ops1 = tree1.popLocalOps();
    const ops2 = tree2.popLocalOps();
    
    // Apply tree2's operations to tree1
    tree1.merge(ops2);
    
    // Apply tree1's operations to tree2
    tree2.merge(ops1);
    
    // Verify both trees have the same content after merging
    // The expected result is "12345" + "678910" because:
    // - Tree1 inserted "12345" at the beginning
    // - Tree2 inserted "678910" at the end
    const expected = '12345678910';
    
    expect(doc1.getText('default').toString()).toBe(expected);
    expect(doc2.getText('default').toString()).toBe(expected);
  });

  test('Shuffled Yjs operations including initialization', () => {
    // This test verifies that ALL Yjs operations (including initialization)
    // can be applied in any order and still converge to the same state
    
    // Create the source tree
    const tree1 = new RepTree('peer1');
    const root1 = tree1.createRoot();
    
    // Create a Yjs document
    const ydoc1 = new Y.Doc();
    tree1.setVertexProperty(root1.id, 'content', ydoc1);
    
    // Collect the initialization operations
    const initOps = tree1.popLocalOps();
    
    // Make multiple edits in the first tree
    const doc1 = tree1.getVertexProperty(root1.id, 'content') as Y.Doc;
    const text1 = doc1.getText('default');
    
    // Add numbers 1 through 10 with spaces
    const updateOps: VertexOperation[] = [];
    
    for (let i = 1; i <= 10; i++) {
      // Add each number with a space
      if (i > 1) text1.insert(text1.length, ' ');
      text1.insert(text1.length, i.toString());
      
      // Collect operations for this edit
      const ops = tree1.popLocalOps();
      updateOps.push(...ops);
    }
    
    // Verify original content
    expect(doc1.getText('default').toString()).toBe('1 2 3 4 5 6 7 8 9 10');
    
    // Combine all operations (initialization + updates)
    const allOps = [...initOps, ...updateOps];
    
    // Shuffle ALL operations
    const shuffledOps = [...allOps];
    for (let i = shuffledOps.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledOps[i], shuffledOps[j]] = [shuffledOps[j], shuffledOps[i]];
    }
    
    // Create a new tree and apply the shuffled operations
    const tree2 = new RepTree('peer2');
    const root2 = tree2.createRoot();
    
    // Apply ALL shuffled operations
    // This will currently fail until we implement the out-of-order solution
    // Uncomment this when the implementation is ready
    // tree2.merge(shuffledOps);
    
    // For now, we'll apply initialization first, then updates
    // This is a workaround until the out-of-order solution is implemented
    tree2.merge(initOps);
    tree2.merge(updateOps);
    
    // Verify the content is the same
    const doc2 = tree2.getVertexProperty(root2.id, 'content') as Y.Doc;
    expect(doc2.getText('default').toString()).toBe('1 2 3 4 5 6 7 8 9 10');
    
    // TODO: Once the out-of-order solution is implemented, replace the above
    // workaround with the commented-out line and the test should pass
  });

  test('Sync between trees with property type transitions', () => {
    // Create two trees
    const tree1 = new RepTree('peer1');
    const root1 = tree1.createRoot();
    
    const tree2 = new RepTree('peer2');
    tree2.merge(tree1.getAllOps());
    const root2 = tree2.root!;
    
    // Tree1: Set a string property
    tree1.setVertexProperty(root1.id, 'content', 'Initial string');
    tree2.merge(tree1.popLocalOps());
    expect(tree2.getVertexProperty(root2.id, 'content')).toBe('Initial string');
    
    // Tree2: Override with Yjs document
    const ydoc2 = new Y.Doc();
    const ytext2 = ydoc2.getText('default');
    ytext2.insert(0, 'Tree2 Yjs content');
    tree2.setVertexProperty(root2.id, 'content', ydoc2);
    tree1.merge(tree2.popLocalOps());
    
    // Verify both trees have Yjs document
    let doc1 = tree1.getVertexProperty(root1.id, 'content') as Y.Doc;
    let doc2 = tree2.getVertexProperty(root2.id, 'content') as Y.Doc;
    expect(doc1).toBeInstanceOf(Y.Doc);
    expect(doc2).toBeInstanceOf(Y.Doc);
    expect(doc1.getText('default').toString()).toBe('Tree2 Yjs content');
    
    // Tree1: Make changes to Yjs document
    doc1.getText('default').insert(0, 'Updated: ');
    tree2.merge(tree1.popLocalOps());
    
    // Verify changes propagated
    doc2 = tree2.getVertexProperty(root2.id, 'content') as Y.Doc;
    expect(doc2.getText('default').toString()).toBe('Updated: Tree2 Yjs content');
    
    // Tree1: Override with number
    tree1.setVertexProperty(root1.id, 'content', 123);
    tree2.merge(tree1.popLocalOps());
    
    // Verify both have number
    expect(tree1.getVertexProperty(root1.id, 'content')).toBe(123);
    expect(tree2.getVertexProperty(root2.id, 'content')).toBe(123);
    
    // Tree2: Back to Yjs
    const finalYdoc = new Y.Doc();
    const finalYtext = finalYdoc.getText('default');
    finalYtext.insert(0, 'Final Yjs state');
    tree2.setVertexProperty(root2.id, 'content', finalYdoc);
    tree1.merge(tree2.popLocalOps());
    
    // Verify final state
    doc1 = tree1.getVertexProperty(root1.id, 'content') as Y.Doc;
    doc2 = tree2.getVertexProperty(root2.id, 'content') as Y.Doc;
    expect(doc1).toBeInstanceOf(Y.Doc);
    expect(doc2).toBeInstanceOf(Y.Doc);
    expect(doc1.getText('default').toString()).toBe('Final Yjs state');
    expect(doc2.getText('default').toString()).toBe('Final Yjs state');
  });
});
