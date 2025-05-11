# Out-of-Order Yjs Operations Proposal

Date: 2025-05-12

## Problem Statement

The current implementation of Yjs integration in RepTree has a limitation: Yjs update operations must be applied after the document has been initialized. This is evident in our tests where we need to ensure that:

1. Both trees have the document properly initialized first
2. Update operations are collected and applied separately

This approach contradicts a fundamental principle of CRDTs: operations should be applicable in any order and still converge to the same state. A robust CRDT implementation should handle operations in any order, including mixing initialization and update operations.

## Current Implementation Analysis

### How RepTree Handles Missing Vertices

For regular property operations, RepTree has a mechanism to handle operations targeting non-existent vertices:

```typescript
// In RepTree.applyProperty
if (!targetVertex) {
  // No need to handle transient properties if the vertex doesn't exist
  if (op.transient) {
    return;
  }

  // If the vertex doesn't exist, we will wait for the move operation to appear that will create the vertex
  // so we can apply the property then.
  if (!this.pendingPropertiesWithMissingVertex.has(op.targetId)) {
    this.pendingPropertiesWithMissingVertex.set(op.targetId, []);
  }
  this.pendingPropertiesWithMissingVertex.get(op.targetId)!.push(op);
  return;
}
```

### How Yjs Updates Are Currently Handled

For Yjs updates, RepTree simply tries to apply the update to the current property value:

```typescript
// In RepTree.applyUpdate
// Get current property value
const currentValue = this.getVertexProperty(vertexId, key);

// Apply update based on CRDT type
if (op.crdtType === "yjs" && currentValue instanceof Y.Doc) {
  // Apply the update directly to the Y.Doc instance
  Y.applyUpdate(currentValue, op.value, 'reptree');
  
  // Report operation as applied
  this.reportOpAsApplied(op);
} else {
  console.warn(`Cannot apply ${op.crdtType} update to property of type ${typeof currentValue}`);
}
```

If the property doesn't exist or isn't a Y.Doc, the update is simply logged as a warning and discarded.

## Proposed Solutions

I propose two potential solutions to handle out-of-order Yjs operations:

### Solution 1: Stash and Apply Approach

Similar to how RepTree handles property operations for non-existent vertices, we can stash Yjs update operations until the document is initialized:

1. Create a new map to store pending Yjs updates: `pendingYjsUpdatesWithMissingProperty: Map<string, ModifyVertexPropertyOp[]>`
2. When a Yjs update operation arrives for a non-existent property, stash it in this map
3. When a property is set (via `applyProperty`), check if there are any pending updates for this property and apply them

This approach is consistent with RepTree's existing patterns and should be relatively straightforward to implement.

### Solution 2: Enhanced Y.Doc Initialization

A more sophisticated approach would be to enhance the Y.Doc initialization process:

1. When a Y.Doc is created as a property, include its initial state in the property operation
2. When a Yjs update operation arrives before the document is initialized, create a new Y.Doc and apply the update to it
3. If a property operation arrives later for the same property, merge the states of the two Y.Doc instances

This approach is more complex but potentially more robust, as it allows for truly out-of-order operations.

## Recommended Solution

I recommend implementing **Solution 1: Stash and Apply Approach** for the following reasons:

1. It's consistent with RepTree's existing patterns for handling missing vertices
2. It's simpler to implement and less prone to errors
3. It maintains the separation of concerns between property setting and updating
4. It's more efficient, as we don't need to create temporary Y.Doc instances

## Implementation Plan

### 1. Add Pending Updates Map

Add a new map to store pending Yjs updates:

```typescript
private pendingYjsUpdatesWithMissingProperty: Map<string, ModifyVertexPropertyOp[]> = new Map();
```

### 2. Modify applyUpdate Method

Update the `applyUpdate` method to stash updates for non-existent properties:

```typescript
private applyUpdate(op: ModifyVertexPropertyOp) {
  const vertexId = op.targetId;
  const key = op.key;
  
  // Update Lamport clock
  this.updateLamportClock(op);
  
  // Get current property value
  const currentValue = this.getVertexProperty(vertexId, key);
  
  // Apply update based on CRDT type
  if (op.crdtType === "yjs" && currentValue instanceof Y.Doc) {
    // Apply the update directly to the Y.Doc instance
    Y.applyUpdate(currentValue, op.value, 'reptree');
    
    // Report operation as applied
    this.reportOpAsApplied(op);
  } else {
    // Stash the update for later application
    const propertyKey = `${key}@${vertexId}`;
    if (!this.pendingYjsUpdatesWithMissingProperty.has(propertyKey)) {
      this.pendingYjsUpdatesWithMissingProperty.set(propertyKey, []);
    }
    this.pendingYjsUpdatesWithMissingProperty.get(propertyKey)!.push(op);
    
    // Still report the operation as applied
    this.reportOpAsApplied(op);
  }
}
```

### 3. Modify applyProperty Method

Update the `applyProperty` method to apply pending updates after setting a Y.Doc property:

```typescript
// Add to the existing applyProperty method after setting a Y.Doc property
if (op.value instanceof Y.Doc) {
  this.setupYjsObserver(op.value, op.targetId, op.key);
  
  // Apply any pending updates for this property
  const propertyKey = `${op.key}@${op.targetId}`;
  const pendingUpdates = this.pendingYjsUpdatesWithMissingProperty.get(propertyKey);
  if (pendingUpdates && pendingUpdates.length > 0) {
    // Apply all pending updates in order
    for (const updateOp of pendingUpdates) {
      Y.applyUpdate(op.value, updateOp.value, 'reptree');
    }
    
    // Clear the pending updates
    this.pendingYjsUpdatesWithMissingProperty.delete(propertyKey);
  }
}
```

### 4. Update Tests

Create a new test specifically for out-of-order operations, where Yjs update operations are applied before the document is initialized:

```typescript
test('Out-of-order Yjs operations', () => {
  // Create a tree
  const tree = new RepTree('peer1');
  const root = tree.createRoot();
  
  // Create a Yjs document and make some changes
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('default');
  ytext.insert(0, 'Hello world');
  
  // Get the update
  const update = Y.encodeStateAsUpdate(ydoc);
  
  // Create a ModifyVertexPropertyOp directly
  const updateOp = newModifyVertexPropertyOp(
    1, // clock
    'peer1', // peerId
    root.id, // targetId
    'content', // key
    'yjs', // crdtType
    update, // value
    false // transient
  );
  
  // Apply the update operation before setting the property
  tree.merge([updateOp]);
  
  // Now set the property
  const newYdoc = new Y.Doc();
  tree.setVertexProperty(root.id, 'content', newYdoc);
  
  // Verify the content was applied
  const retrievedDoc = tree.getVertexProperty(root.id, 'content') as Y.Doc;
  expect(retrievedDoc.getText('default').toString()).toBe('Hello world');
});
```

## Benefits

This solution will:

1. Allow Yjs operations to be applied in any order
2. Maintain the convergence property of CRDTs
3. Be consistent with RepTree's existing patterns
4. Be relatively simple to implement and test

## Limitations

The main limitation of this approach is that it requires storing pending updates in memory, which could potentially grow large if many updates are received before the document is initialized. However, this is a reasonable trade-off for the benefits of true out-of-order operation support.

## Conclusion

By implementing the stash and apply approach for Yjs update operations, RepTree will provide a more robust CRDT implementation that can handle operations in any order. This will make the library more resilient to network delays and other real-world scenarios where operations might arrive out of order.
