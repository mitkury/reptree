# Yjs Integration: Specification

Date: 2025-04-18

## Overview

This specification defines a type-based approach for integrating Yjs CRDT documents into RepTree's property system, enabling real-time collaborative editing at the property level while maintaining compatibility with RepTree's operation-based model.

## Extended Type System

RepTree's `VertexPropertyType` will be extended to include Yjs documents:

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

## API Extensions

### Document Creation

```typescript
// Create a Yjs document for a specific type
const yjsDoc = tree.createYjsDocument(yjsType: 'text' | 'map' | 'array' | 'xmlFragment'): YjsDocument
```

### Property Operations

The existing API remains unchanged:

```typescript
// Set a Yjs document as a property value
tree.setVertexProperty(vertexId: string, key: string, yjsDoc: YjsDocument)

// Retrieve a property that may be a Yjs document
const property = tree.getVertexProperty(vertexId: string, key: string)
```

### Working with Yjs Documents

```typescript
// Get a live Yjs document instance from a property value
const doc = tree.getYjsDocument(property: YjsDocument): Y.Doc

// Get a specific Yjs shared type from the document
const ytext = doc.getText('default') // For text
const ymap = doc.getMap('default')   // For map
const yarray = doc.getArray('default') // For array
```

## Operation Flow

1. **Creation**: When a Yjs document is created, a new Y.Doc instance is instantiated and maintained in memory.

2. **Storage**: The Yjs document is serialized and stored as a `YjsDocument` property value.

3. **Updates**:
   - When the Yjs document changes, its 'update' event is captured
   - The document is re-serialized and a new `SetVertexProperty` operation is created
   - This operation is processed like any other property update

4. **Sync**:
   - RepTree's normal operation sync mechanism distributes property updates
   - When a property with a Yjs document is received, it's deserialized and available for editing

## Conflict Resolution

The system uses a hybrid approach to conflict resolution:

- **RepTree Level**: Lamport clocks determine the ordering of property update operations
- **Yjs Level**: Yjs's internal CRDT mechanisms handle fine-grained collaborative edits

Conflict resolution strategy is determined by the property's type:
- Primitive types use RepTree's standard LWW mechanism
- Yjs document properties use Yjs's built-in CRDT resolution

## Optimization Strategies

### Network Efficiency

- Yjs documents emit delta updates that only contain changes
- RepTree operations carry these deltas instead of full document state when possible
- When peers connect, they exchange state vectors to sync only missing changes

### Storage Efficiency

- Lazy loading: Yjs documents are deserialized only when accessed
- Compression: Serialized documents can be compressed for storage
- Garbage collection: Yjs's built-in GC removes unneeded tombstones

## Usage Examples

### Rich Text Editing

```typescript
// Create a collaborative text document
const yjsDoc = tree.createYjsDocument('text');
tree.setVertexProperty(vertexId, 'content', yjsDoc);

// Edit the document
const doc = tree.getVertexProperty(vertexId, 'content');
if (doc && doc._type === 'yjs') {
  const ydoc = tree.getYjsDocument(doc);
  const ytext = ydoc.getText('default');
  
  // Modifications automatically propagate to other peers
  ytext.insert(0, 'Hello, collaborative world!');
  
  // Bind to editor
  const binding = new Y.CodeMirror.Binding(ytext, editor);
}
```

### Structured Data

```typescript
// Create a collaborative map
const yjsDoc = tree.createYjsDocument('map');
tree.setVertexProperty(vertexId, 'metadata', yjsDoc);

// Work with the map
const doc = tree.getVertexProperty(vertexId, 'metadata');
if (doc && doc._type === 'yjs') {
  const ydoc = tree.getYjsDocument(doc);
  const ymap = ydoc.getMap('default');
  
  // Modifications automatically propagate
  ymap.set('title', 'Collaborative Document');
  ymap.set('tags', ['collaboration', 'realtime']);
}
```

## Implementation Phases

1. **Core Type System**: Extend the type system with Yjs document support
2. **Basic API**: Implement document creation, serialization, and event handling
3. **Optimizations**: Add delta-based updates and efficient synchronization
4. **Editor Bindings**: Develop connectors for common editors (CodeMirror, Monaco, etc.)
5. **Advanced Features**: Awareness, cursor positions, and history 