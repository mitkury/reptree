import { bench, describe } from 'vitest';
import { RepTree } from '../src/RepTree';
import * as Y from 'yjs';

describe('RepTree Yjs Integration Performance', () => {
  bench('Yjs document property updates', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    
    // Create a vertex with a Yjs document property
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('text');
    ytext.insert(0, 'initial text');
    
    const vertex = tree.newVertex(root.id, { content: ydoc });
    
    // Benchmark Yjs document updates
    for (let i = 0; i < 100; i++) {
      // Get the Yjs document
      const doc = tree.getVertexProperty(vertex.id, 'content') as Y.Doc;
      if (doc) {
        // Update the text
        const text = doc.getText('text');
        text.insert(text.length, ` - update ${i}`);
      }
    }
  });

  bench('collaborative editing between trees', () => {
    // Setup two trees
    const treeA = new RepTree('peerA');
    const rootA = treeA.createRoot();
    
    // Create a vertex with a Yjs document in the first tree
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('text');
    ytext.insert(0, 'initial text');
    
    const vertexA = treeA.newVertex(rootA.id, { content: ydoc });
    
    // Get operations from the first tree
    const ops = treeA.getAllOps();
    
    // Create a second tree and apply operations
    const treeB = new RepTree('peerB');
    treeB.merge(ops);
    
    // Get the vertex in the second tree
    const vertexB = treeB.getVertex(vertexA.id);
    
    if (vertexB) {
      // Benchmark collaborative editing
      for (let i = 0; i < 50; i++) {
        // Update in tree A
        const docA = treeA.getVertexProperty(vertexA.id, 'content') as Y.Doc;
        if (docA) {
          const textA = docA.getText('text');
          textA.insert(textA.length, ` - A${i}`);
        }
        
        // Get the update from tree A
        const opsA = treeA.popLocalOps();
        
        // Apply to tree B
        treeB.merge(opsA);
        
        // Update in tree B
        const docB = treeB.getVertexProperty(vertexB.id, 'content') as Y.Doc;
        if (docB) {
          const textB = docB.getText('text');
          textB.insert(textB.length, ` - B${i}`);
        }
        
        // Get the update from tree B
        const opsB = treeB.popLocalOps();
        
        // Apply to tree A
        treeA.merge(opsB);
      }
    }
  });

  bench('concurrent Yjs updates with conflict resolution', () => {
    // Setup two trees
    const treeA = new RepTree('peerA');
    const rootA = treeA.createRoot();
    
    // Create a vertex with a Yjs document in the first tree
    const ydoc = new Y.Doc();
    const ymap = ydoc.getMap('map');
    
    const vertexA = treeA.newVertex(rootA.id, { content: ydoc });
    
    // Get operations from the first tree
    const ops = treeA.getAllOps();
    
    // Create a second tree and apply operations
    const treeB = new RepTree('peerB');
    treeB.merge(ops);
    
    // Get the vertex in the second tree
    const vertexB = treeB.getVertex(vertexA.id);
    
    if (vertexB) {
      // Benchmark concurrent updates with conflict resolution
      for (let i = 0; i < 50; i++) {
        // Concurrent updates in both trees
        const docA = treeA.getVertexProperty(vertexA.id, 'content') as Y.Doc;
        const docB = treeB.getVertexProperty(vertexB.id, 'content') as Y.Doc;
        
        if (docA && docB) {
          // Update the same key in both trees
          const mapA = docA.getMap('map');
          const mapB = docB.getMap('map');
          
          mapA.set(`key-${i}`, `value-A-${i}`);
          mapB.set(`key-${i}`, `value-B-${i}`);
          
          // Exchange updates
          const opsA = treeA.popLocalOps();
          const opsB = treeB.popLocalOps();
          
          treeB.merge(opsA);
          treeA.merge(opsB);
        }
      }
    }
  });
});
