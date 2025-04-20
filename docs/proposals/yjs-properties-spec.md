# Yjs Integration Specification

Date: 2025-04-18
Updated: 2025-04-22

## Overview

This specification defines the approach for integrating Yjs CRDT documents into RepTree's property system, enabling real-time collaborative editing at the property level while maintaining compatibility with RepTree's operation-based model.

## Direct Y.Doc Properties Implementation

### Extended Type System

Y.Doc is directly supported as a property type:

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
   - RepTree stores the Y.Doc instance directly in the vertex property
   - RepTree attaches an observer to detect changes

2. When changes occur in the Y.Doc:
   - The observer detects the change and captures the binary update
   - RepTree creates a special 'yjs-update' operation with just the binary delta
   - The update operation is propagated through normal RepTree sync mechanisms

3. When getting a property that's a Y.Doc:
   - The live Y.Doc instance is returned directly
   - Any changes made to it are automatically observed

### Optimizing Operation Size

A critical aspect of this approach is ensuring efficient network transmission by minimizing operation size when documents are edited.

### Efficient Update Encoding

We leverage Yjs's built-in differential update mechanism to ensure operations contain only the changes rather than the entire document state:

```typescript
// When a document changes, we create an operation with just the changes
ydoc.on('update', (update, origin) => {
  // 'update' contains only the changes since the last update
  if (origin !== 'reptree') {
    // Create a RepTree property operation with just this delta
    const op = {
      id: new OpId(this.lamportClock++, this.peerId),
      targetId: vertexId,
      key: key,
      value: {
        _type: 'yjs-update',
        update: update  // Binary update data
      },
      transient: false
    };
    
    this.localOps.push(op);
    this.applyProperty(op);
  }
});
```

### Sync Optimization

For synchronizing between peers, we implement these optimizations:

1. **Initial Sync**:
   - For complete document synchronization, we send the full Y.Doc instance in the property

2. **Incremental Updates**:
   - For ongoing changes, we send only the update operations containing the binary encoded deltas
   - These deltas contain only the changed information, not the entire document

3. **Distributed Updates**:
   - RepTree's operation exchange mechanism handles distributing Yjs updates
   - The Yjs documents maintain internal state while RepTree manages operation synchronization

### Implementation Details

```typescript
// Special handling for Yjs updates in the applyProperty method
applyProperty(op) {
  const property = op.value;
  
  // Check if this is a Yjs update
  if (property && property._type === 'yjs-update') {
    const vertexId = op.targetId;
    const key = op.key;
    
    // Get current property value
    const currentValue = this.getVertexProperty(vertexId, key);
    
    if (currentValue instanceof Y.Doc) {
      // Apply the update directly to the Y.Doc instance
      Y.applyUpdate(currentValue, property.update);
    }
  } 
  // Regular property handling for all other properties (including full Y.Doc properties)
  else {
    // Handle regular property updates
    this.setVertexProperty(op.targetId, op.key, property);
  }
}

// When setting a Y.Doc property, set up an observer
setVertexProperty(vertexId: string, key: string, value: any): void {
  if (value instanceof Y.Doc) {
    // Make sure we have an observer for this document
    this.setupYjsObserver(value, vertexId, key);
  }
  
  // Call the regular setVertexProperty implementation
  super.setVertexProperty(vertexId, key, value);
}

// Set up observer for a Y.Doc to catch updates
setupYjsObserver(doc: Y.Doc, vertexId: string, key: string) {
  doc.on('update', (update, origin) => {
    if (origin !== 'reptree') {
      const op = {
        id: new OpId(this.lamportClock++, this.peerId),
        targetId: vertexId,
        key: key,
        value: {
          _type: 'yjs-update',
          update: update
        },
        transient: false
      };
      
      this.localOps.push(op);
      this.applyProperty(op);
    }
  });
}
```

## Conflict Resolution

The approach uses a hybrid conflict resolution strategy:

- **RepTree Level**: Lamport clocks determine the ordering of property update operations
- **Yjs Level**: Yjs's internal CRDT mechanisms handle fine-grained collaborative edits

## Usage Example

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

## Implementation Plan

1. **Phase 1**: Core implementation
   - Extended type system with direct Y.Doc support
   - Observer setup and update handling
   - Basic test cases

2. **Phase 2**: Additional features
   - Optimized synchronization
   - Performance improvements
   - More comprehensive tests
}