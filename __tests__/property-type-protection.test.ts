import { describe, test, expect } from 'vitest';
import { RepTree } from '../dist/index.js';

describe('Property Type Protection', () => {
  test('should maintain type consistency for properties (first-writer-wins)', () => {
    // Create a new tree
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    
    // Set a string property
    tree.setVertexProperty(root.id, 'title', 'Document Title');
    
    // Try to change the type to a number - should be ignored due to type protection
    tree.setVertexProperty(root.id, 'title', 123);
    
    // Verify the property is still a string with the original value
    expect(tree.getVertexProperty(root.id, 'title')).toBe('Document Title');
    
    // Update with the same type - should work
    tree.setVertexProperty(root.id, 'title', 'Updated Title');
    expect(tree.getVertexProperty(root.id, 'title')).toBe('Updated Title');
  });

  test('should allow setting different property types on different properties', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    
    // Set properties of different types
    tree.setVertexProperty(root.id, 'title', 'Document Title');
    tree.setVertexProperty(root.id, 'count', 42);
    tree.setVertexProperty(root.id, 'isActive', true);
    tree.setVertexProperty(root.id, 'tags', ['important', 'document']);
    
    // Verify all properties have their correct types and values
    expect(tree.getVertexProperty(root.id, 'title')).toBe('Document Title');
    expect(tree.getVertexProperty(root.id, 'count')).toBe(42);
    expect(tree.getVertexProperty(root.id, 'isActive')).toBe(true);
    expect(tree.getVertexProperty(root.id, 'tags')).toEqual(['important', 'document']);
  });

  test('should maintain type consistency across peers', () => {
    // Create two trees
    const tree1 = new RepTree('peer1');
    const root1 = tree1.createRoot();
    
    // Set a number property on the first tree
    tree1.setVertexProperty(root1.id, 'count', 42);
    
    // Sync operations to the second tree
    const tree2 = new RepTree('peer2');
    const ops = tree1.getAllOps();
    tree2.merge(ops);
    
    const root2 = tree2.root;
    
    // Try to change the type on the second tree
    tree2.setVertexProperty(root2!.id, 'count', 'forty-two');
    
    // Verify the property is still a number on the second tree
    expect(tree2.getVertexProperty(root2!.id, 'count')).toBe(42);
    
    // Update with the same type on the second tree
    tree2.setVertexProperty(root2!.id, 'count', 100);
    expect(tree2.getVertexProperty(root2!.id, 'count')).toBe(100);
    
    // Sync back to the first tree
    const ops2 = tree2.getAllOps();
    tree1.merge(ops2);
    
    // Verify the update was applied on the first tree
    expect(tree1.getVertexProperty(root1.id, 'count')).toBe(100);
  });

  test('should handle concurrent updates with type protection', () => {
    // Create initial tree and set a property
    const tree1 = new RepTree('peer1');
    const root1 = tree1.createRoot();
    tree1.setVertexProperty(root1.id, 'status', 'pending');
    
    // Clone the tree to simulate a second peer
    const tree2 = new RepTree('peer2');
    tree2.merge(tree1.getAllOps());
    const root2 = tree2.root;
    
    // Both peers make concurrent updates - one changes type, one doesn't
    tree1.setVertexProperty(root1.id, 'status', 'completed'); // Same type
    tree2.setVertexProperty(root2!.id, 'status', 123); // Different type
    
    // Sync from peer2 to peer1
    tree1.merge(tree2.getAllOps());
    
    // The type change should be rejected, keeping the string type
    expect(tree1.getVertexProperty(root1.id, 'status')).toBe('completed');
    
    // Sync from peer1 to peer2
    tree2.merge(tree1.getAllOps());
    
    // Both peers should have the same value and type
    expect(tree2.getVertexProperty(root2!.id, 'status')).toBe('completed');
  });

  test('should protect transient property types as well', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    
    // Set a transient boolean property
    tree.setTransientVertexProperty(root.id, 'isEditing', true);
    
    // Try to change the type to a string - should be ignored
    tree.setTransientVertexProperty(root.id, 'isEditing', 'yes');
    
    // Verify the property is still a boolean
    expect(tree.getVertexProperty(root.id, 'isEditing')).toBe(true);
    
    // Update with the same type - should work
    tree.setTransientVertexProperty(root.id, 'isEditing', false);
    expect(tree.getVertexProperty(root.id, 'isEditing')).toBe(false);
  });

  test('should demonstrate type protection is independent of operation IDs', () => {
    // This test demonstrates that type protection works independently of the
    // Last-Writer-Wins (LWW) mechanism and operation IDs

    // Create a tree and root vertex
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    
    // First, establish a property with a string type
    tree.setVertexProperty(root.id, 'status', 'active');
    expect(tree.getVertexProperty(root.id, 'status')).toBe('active');
    
    // Now try to change the type to a number
    tree.setVertexProperty(root.id, 'status', 42);
    
    // The type change should be rejected, even though it has a higher Lamport clock
    // (since it's a later operation from the same peer)
    expect(tree.getVertexProperty(root.id, 'status')).toBe('active');
    
    // Now update with the same type - this should work because the type is the same
    tree.setVertexProperty(root.id, 'status', 'updated');
    expect(tree.getVertexProperty(root.id, 'status')).toBe('updated');
    
    // Let's also verify that we can extract the operations and see that the type change was rejected
    const ops = tree.getAllOps();
    
    // We should have 3 operations: root creation, initial property set, and the successful update
    // The rejected type change operation should not be included in the operation list
    // (though it is added to knownOps to avoid reprocessing)
    
    // Count the setProperty operations for the 'status' key
    const statusOps = ops.filter(op => 
      'key' in op && op.key === 'status' && 'targetId' in op && op.targetId === root.id
    );
    
    // We should have exactly 3 operations for 'status' (including the rejected type change)
    expect(statusOps.length).toBe(3);
    
    // But the final value should still be 'updated', not 42, because the type change was rejected
    expect(tree.getVertexProperty(root.id, 'status')).toBe('updated');
    
    // Verify the operations are in the correct order and have the expected values
    const statusValues = statusOps.map(op => 'value' in op ? op.value : null);
    expect(statusValues).toEqual(['active', 42, 'updated']);
    
    // Now let's test if applying the operations in reverse order results in the same tree
    const reversedOps = [...ops].reverse();
    const newTree = new RepTree('peer3');
    newTree.merge(reversedOps);
    
    // The final value should still be 'updated', even when ops are applied in reverse
    const newRoot = newTree.root;
    expect(newRoot).toBeDefined();
    expect(newTree.getVertexProperty(newRoot!.id, 'status')).toBe('updated');
    
    // Verify that the trees are structurally identical
    expect(tree.compareStructure(newTree)).toBe(true);
    
    // Verify that the specific property we care about matches
    // Note: We don't compare all properties because system properties like timestamps might differ
    const originalStatusValue = tree.getVertexProperty(root.id, 'status');
    const newStatusValue = newTree.getVertexProperty(newRoot!.id, 'status');
    expect(originalStatusValue).toEqual(newStatusValue);
  });
});
