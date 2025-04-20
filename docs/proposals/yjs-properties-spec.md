# Yjs Integration Specification

Date: 2025-04-18
Updated: 2025-04-20

## Overview

This specification defines approaches for integrating Yjs CRDT documents into RepTree's property system, enabling real-time collaborative editing at the property level while maintaining compatibility with RepTree's operation-based model.

## Implementation Approaches

We propose two approaches to Yjs integration:

1. **Explicit Wrapper Approach** (Implemented): Uses a wrapper type to explicitly mark Yjs documents
2. **Direct Y.Doc Approach** (Proposed): Uses Y.Doc directly as a property type with automatic change detection

## Approach 1: Explicit Wrapper Type (Current Implementation)

### Extended Type System

```typescript
export type YjsDocument = {
  _type: 'yjs';
  yjsType: 'map' | 'array' | 'text' | 'xmlFragment';
  data: Uint8Array;  // Serialized Yjs document state
}

export type VertexPropertyType = 
  | string 
  | number 
  | boolean 
  | string[] 
  | number[] 
  | boolean[] 
  | undefined
  | YjsDocument;
```

### API

```typescript
// Create a Yjs document
const yjsDoc = tree.createYjsDocument('text');
tree.setVertexProperty(vertexId, 'content', yjsDoc);

// Get and modify a Yjs document
const property = tree.getVertexProperty(vertexId, 'content');
const ydoc = tree.getYjsDocument(property, vertexId, 'content');
const ytext = ydoc.getText('default');
ytext.insert(0, 'Hello world');

// Update the property after changes
tree.updateYjsDocumentProperty(vertexId, 'content', ydoc, 'text');
```

### Advantages
- Clear separation between RepTree properties and Yjs documents
- Explicit control over when updates are propagated
- Straightforward serialization

### Disadvantages
- More verbose API
- Manual update step required
- Extra conversion between types

## Approach 2: Direct Y.Doc Properties (Proposed Enhancement)

### Extended Type System

Y.Doc would be directly supported as a property type:

```typescript
export type VertexPropertyType = 
  | string 
  | number 
  | boolean 
  | string[] 
  | number[] 
  | boolean[] 
  | undefined
  | Y.Doc;  // Direct Yjs document support
```

### API

```typescript
// Create and set a Yjs document property
const ydoc = new Y.Doc();
const ytext = ydoc.getText('default');
ytext.insert(0, 'Hello world');
tree.setVertexProperty(vertexId, 'content', ydoc);

// Get and modify a document property
const doc = tree.getVertexProperty(vertexId, 'content') as Y.Doc;
const text = doc.getText('default');
text.insert(text.length, ' and universe!');
// No explicit update call needed - changes are detected automatically
```

### Internal Implementation

1. When a Y.Doc is set as a property:
   - RepTree serializes it to a binary format
   - RepTree attaches an observer to detect changes
   - RepTree creates an initial property operation

2. When changes occur in the Y.Doc:
   - The observer detects the change
   - RepTree automatically serializes the updated state
   - RepTree creates a new property operation
   - Changes propagate through normal RepTree sync mechanisms

3. When getting a property that's a Y.Doc:
   - RepTree checks if it's already deserialized in cache
   - If not, it deserializes the binary data into a live Y.Doc
   - The Y.Doc is returned with observers attached

### Advantages
- Cleaner, more intuitive API
- No manual update step required
- More native feel for both RepTree and Yjs users

### Disadvantages
- More complex internal implementation
- Potential for unexpected behavior with observers
- Serialization/deserialization happens implicitly

## Optimizing Operation Size

A critical aspect of both approaches is ensuring efficient network transmission by minimizing operation size when documents are edited.

### Efficient Update Encoding

For both approaches, we leverage Yjs's built-in differential update mechanism to ensure operations contain only the changes rather than the entire document state:

```typescript
// When a document changes, we can generate a minimal update by:
ydoc.on('update', (update, origin) => {
  // 'update' contains only the changes since the last update
  // This is already a compressed binary format
  if (origin !== 'reptree') {
    // Create a RepTree property operation with just this delta
    createPropertyOp(vertexId, key, update);
  }
});
```

### State Vector Optimization

For synchronizing between peers, we implement the state vector optimization:

1. **Initial Sync**:
   - For complete document synchronization, we use `Y.encodeStateAsUpdate(ydoc)`

2. **Incremental Updates**:
   - For ongoing changes, we use Yjs's update events which provide binary encoded deltas
   - These deltas contain only the changed information, not the entire document

3. **Targeted Syncs**:
   - RepTree's operation exchange mechanism will handle distributing Yjs updates
   - The Yjs documents will maintain internal state while RepTree manages operation synchronization

### Approach 1 Implementation (Current)

In our current implementation, `updateYjsDocumentProperty` uses the above optimizations:

```typescript
updateYjsDocumentProperty(vertexId, key, ydoc, yjsType) {
  // Generate optimized update that only contains changes
  const stateVector = this.getStoredStateVector(vertexId, key);
  const update = Y.encodeStateAsUpdate(ydoc, stateVector);
  
  // Store the current state vector for future delta generation
  this.storeStateVector(vertexId, key, Y.encodeStateVector(ydoc));
  
  // Create property operation with this minimal update
  this.setVertexProperty(vertexId, key, {
    _type: 'yjs',
    yjsType,
    data: update
  });
}
```

### Approach 2 Implementation (Proposed)

The automatic update detection would similarly use these optimizations:

```typescript
// When attaching observer to a Y.Doc property
attachObserver(vertexId, key, ydoc) {
  ydoc.on('update', (update, origin) => {
    if (origin !== 'reptree') {
      // Only create a new property operation with this delta update
      // No need to re-serialize the entire document
      this.setVertexProperty(vertexId, key, ydoc, 'reptree');
    }
  });
}
```

## Conflict Resolution

Both approaches use a hybrid conflict resolution strategy:

- **RepTree Level**: Lamport clocks determine the ordering of property update operations
- **Yjs Level**: Yjs's internal CRDT mechanisms handle fine-grained collaborative edits

## Usage Examples

### Approach 1 (Current Implementation)

```typescript
// Create a collaborative text document
const yjsDoc = tree.createYjsDocument('text');
tree.setVertexProperty(vertexId, 'content', yjsDoc);

// Edit the document
const property = tree.getVertexProperty(vertexId, 'content');
if (isYjsDocument(property)) {
  const ydoc = tree.getYjsDocument(property, vertexId, 'content');
  const ytext = ydoc.getText('default');
  
  // Make changes to the document
  ytext.insert(0, 'Hello, collaborative world!');
  
  // Update the property with changes
  tree.updateYjsDocumentProperty(vertexId, 'content', ydoc, 'text');
}
```

### Approach 2 (Proposed Enhancement)

```typescript
// Create a collaborative text document
const ydoc = new Y.Doc();
const ytext = ydoc.getText('default');
ytext.insert(0, 'Hello, collaborative world!');
tree.setVertexProperty(vertexId, 'content', ydoc);

// Later, edit the document
const doc = tree.getVertexProperty(vertexId, 'content') as Y.Doc;
const text = doc.getText('default');
text.insert(text.length, ' More text added later!');
// Changes are automatically detected and propagated
```

## Recommendation

We recommend starting with Approach 1 (Explicit Wrapper) as it's simpler to implement and reason about. Once this is stable, we can consider implementing Approach 2 (Direct Y.Doc) as an enhancement for a cleaner API.

For initial implementation, the explicit approach provides better control over when updates happen and makes the flow more predictable.

## Implementation Plan

1. **Phase 1 (Completed)**: Implement Approach 1 with explicit wrapper type
   - Extended type system with YjsDocument
   - Basic creation, retrieval, and update methods
   - Serialization/deserialization of documents
   - Basic test cases

2. **Phase 2 (Next)**: Additional features for Approach 1
   - Optimized synchronization
   - Performance improvements
   - More comprehensive tests

3. **Phase 3 (Future)**: Implement Approach 2 with direct Y.Doc support
   - Automatic change detection
   - Transparent serialization
   - Migration path from Approach 1 

### Property Operation Structure

The actual property operation created for Yjs updates would look like this:

```typescript
// Implementation of createPropertyOp for Yjs updates
function createPropertyOp(vertexId, key, update) {
  // For Approach 1: YjsDocument wrapper
  const yjsDoc = {
    _type: 'yjs',
    yjsType: this.getStoredYjsType(vertexId, key), // Get the document type from cache
    data: update // The binary delta update
  };
  
  // Create a standard RepTree SetVertexProperty operation
  const op = {
    id: new OpId(this.lamportClock++, this.peerId),
    targetId: vertexId,
    key: key,
    value: yjsDoc,
    transient: false
  };
  
  // Add to local operations and apply
  this.localOps.push(op);
  this.applyProperty(op);
}
```

### Applying Yjs Update Operations

When receiving and applying a Yjs update operation, RepTree would handle it differently from regular properties:

```typescript
// Special handling for Yjs updates in the applyProperty method
applyProperty(op) {
  const property = op.value;
  
  // Check if this is a Yjs document update
  if (isYjsDocument(property)) {
    const vertexId = op.targetId;
    const key = op.key;
    
    // Get current property value if it exists
    const currentValue = this.getVertexProperty(vertexId, key);
    
    if (currentValue && isYjsDocument(currentValue)) {
      // If we already have a Yjs document property, we need to apply the update
      // to the existing document
      
      // Create a temporary Y.Doc to decode the update
      const tempDoc = new Y.Doc();
      
      // Apply the update to the temp doc
      Y.applyUpdate(tempDoc, property.data);
      
      // Extract the updated data
      const updatedData = Y.encodeStateAsUpdate(tempDoc);
      
      // Store the updated document in the vertex property
      this.setVertexProperty(vertexId, key, {
        _type: 'yjs',
        yjsType: property.yjsType,
        data: updatedData
      });
      
      // When accessing this property later through getYjsDocument(),
      // we'll deserialize it on demand
    } else {
      // No existing Yjs document, just set the property directly
      this.setVertexProperty(vertexId, key, property);
    }
  } else {
    // Handle regular property updates
    this.setVertexProperty(op.targetId, op.key, property);
  }
}

/**
 * Gets a live Y.Doc from a property value
 */
getYjsDocument(property: YjsDocument, vertexId: string, key: string): Y.Doc {
  // Create a new Y.Doc and apply the stored update
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, property.data);
  
  // Set up an observer to handle changes to the document
  ydoc.on('update', (update, origin) => {
    if (origin !== 'reptree') {
      this.updateYjsDocumentProperty(vertexId, key, ydoc, property.yjsType);
    }
  });
  
  return ydoc;
}

/**
 * Updates a Yjs document property with the latest changes
 */
updateYjsDocumentProperty(vertexId: string, key: string, ydoc: Y.Doc, yjsType: string): void {
  // Create an update from the current state
  const update = Y.encodeStateAsUpdate(ydoc);
  
  // Create and apply a property update operation
  this.setVertexProperty(vertexId, key, {
    _type: 'yjs',
    yjsType,
    data: update
  });
}