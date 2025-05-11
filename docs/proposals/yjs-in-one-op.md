# CRDT Property Type Refactoring Proposal

Date: 2025-05-12

## Overview

This proposal outlines a refactoring approach to simplify how RepTree handles CRDT-based properties (specifically Yjs documents). The core idea is to keep the existing `SetVertexProperty` operation but modify the `VertexPropertyType` to include a serializable `CRDTType` instead of directly using `Y.Doc`. When applying operations, RepTree will detect CRDT properties and apply updates using the appropriate CRDT mechanism rather than Last-Writer-Wins (LWW).

## Current Implementation

Currently, RepTree uses two separate operation types for property management:

1. `SetVertexProperty` - For setting regular properties (strings, numbers, booleans, arrays, and Y.Doc)
2. `ModifyVertexPropertyOp` - For applying updates to Yjs documents

This separation creates several challenges:
- Duplicate code paths for property handling
- Complex type checking and operation discrimination
- Separate synchronization logic for different property types
- Direct dependency on Y.Doc in the type system, making serialization more complex

## Proposed Changes

### 1. Extended Property Type System

Extend the `VertexPropertyType` to include a serializable `CRDTType` instead of directly using `Y.Doc`:

```typescript
// New CRDTType for serializable CRDT data
export interface CRDTType {
  type: string;           // e.g., "yjs"
  value: Uint8Array;      // Serialized CRDT state
}

// Updated VertexPropertyType
export type VertexPropertyType = 
  | string 
  | number 
  | boolean 
  | string[] 
  | number[] 
  | boolean[] 
  | undefined
  | CRDTType;  // Replace Y.Doc with CRDTType
```

### 2. Keep SetVertexProperty As Is

The existing `SetVertexProperty` operation remains unchanged, but now accepts the new `CRDTType` as part of `VertexPropertyType`:

```typescript
export interface SetVertexProperty {
  id: OpId;
  targetId: string;
  key: string;
  value: VertexPropertyType; // Now includes CRDTType
  transient: boolean;
}
```

### 3. CRDT Detection and Handling

When applying operations, the system will detect CRDT properties and handle them accordingly:

```typescript
applyProperty(op: SetVertexProperty) {
  const { targetId, key, value, transient } = op;
  
  // Check if this is a CRDT property
  if (value && typeof value === 'object' && 'type' in value && 'value' in value) {
    const crdtValue = value as CRDTType;
    
    // Get current property if it exists
    const currentProperty = this.getVertexProperty(targetId, key);
    const currentYDoc = this.getYDocFromProperty(currentProperty);
    
    if (crdtValue.type === "yjs") {
      if (currentYDoc) {
        // Apply update to existing Y.Doc
        Y.applyUpdate(currentYDoc, crdtValue.value, 'reptree');
      } else {
        // Create new Y.Doc if property doesn't exist or isn't a Y.Doc
        const newDoc = new Y.Doc();
        Y.applyUpdate(newDoc, crdtValue.value);
        
        // Store the Y.Doc in memory for active use
        this.activeYDocs.set(`${key}@${targetId}`, newDoc);
        
        // Set up observer for the new Y.Doc
        this.setupYjsObserver(newDoc, targetId, key);
      }
      
      // Store the serialized CRDT value
      this.setPropertyValue(targetId, key, crdtValue, transient);
    }
  } else {
    // Handle primitive property types (standard LWW behavior)
    this.setPropertyValue(targetId, key, value, transient);
  }
}

// Helper method to get Y.Doc from property
getYDocFromProperty(property: VertexPropertyType): Y.Doc | null {
  if (property && typeof property === 'object' && 'type' in property && property.type === 'yjs') {
    const crdtValue = property as CRDTType;
    const key = `${key}@${targetId}` as PropertyKeyAtVertexId;
    
    // Check if we have an active Y.Doc for this property
    let yDoc = this.activeYDocs.get(key);
    
    if (!yDoc) {
      // Create a new Y.Doc from the serialized state
      yDoc = new Y.Doc();
      Y.applyUpdate(yDoc, crdtValue.value);
      this.activeYDocs.set(key, yDoc);
      this.setupYjsObserver(yDoc, targetId, key);
    }
    
    return yDoc;
  }
  
  return null;
}
```

### 4. Y.Doc to CRDTType Conversion

When setting a Y.Doc property, the system will automatically convert it to a CRDTType:

```typescript
setVertexProperty(vertexId: string, key: string, value: VertexPropertyType | Y.Doc) {
  let finalValue: VertexPropertyType;
  
  // Convert Y.Doc to CRDTType if needed
  if (value instanceof Y.Doc) {
    // Create a CRDTType from the Y.Doc
    const state = Y.encodeStateAsUpdate(value);
    finalValue = {
      type: "yjs",
      value: state
    };
    
    // Store the active Y.Doc for this property
    const propertyKey = `${key}@${vertexId}` as PropertyKeyAtVertexId;
    this.activeYDocs.set(propertyKey, value);
    
    // Set up observer for future changes
    this.setupYjsObserver(value, vertexId, key);
  } else {
    finalValue = value;
  }
  
  // Create the standard SetVertexProperty operation
  const op = newSetVertexPropertyOp(
    this.lamportClock++,
    this.peerId,
    vertexId,
    key,
    finalValue
  );
  
  this.localOps.push(op);
  this.applyProperty(op);
}

// Helper method to get a Y.Doc from a property
getVertexPropertyAsYDoc(vertexId: string, key: string): Y.Doc | null {
  const property = this.getVertexProperty(vertexId, key);
  return this.getYDocFromProperty(property, vertexId, key);
}
```

### 5. Yjs Observer Implementation

The Yjs observer creates standard SetVertexProperty operations with CRDTType values:

```typescript
setupYjsObserver(doc: Y.Doc, vertexId: string, key: string) {
  // Remove any existing observer
  const observerKey = `${key}@${vertexId}` as PropertyKeyAtVertexId;
  const existingObserver = this.yjsObservers.get(observerKey);
  if (existingObserver) {
    doc.off('update', existingObserver);
  }
  
  // Create and store the new observer
  const observer = (update: Uint8Array, origin: any) => {
    if (origin !== 'reptree') {
      // Create a standard SetVertexProperty operation with the update
      const crdtValue: CRDTType = {
        type: "yjs",
        value: update
      };
      
      const op = newSetVertexPropertyOp(
        this.lamportClock++,
        this.peerId,
        vertexId,
        key,
        crdtValue
      );
      
      this.localOps.push(op);
      this.applyProperty(op);
    }
  };
  
  doc.on('update', observer);
  this.yjsObservers.set(observerKey, observer);
}
```

## Benefits

1. **Simplified Type System**: CRDTType is serializable, unlike Y.Doc
2. **Unified Operation Type**: Only SetVertexProperty is needed for all property changes
3. **Improved CRDT Handling**: Automatic detection and application of CRDT updates
4. **Future Extensibility**: Easy to add new CRDT types beyond Yjs
5. **Reduced Complexity**: Elimination of ModifyVertexPropertyOp
6. **Better Serialization**: CRDTType can be easily serialized for storage or transmission
7. **Cleaner API**: Consistent interface for all property types

## Implementation Plan

1. **Phase 1**: Extend the type system
   - Define the `CRDTType` interface
   - Update `VertexPropertyType` to include CRDTType instead of Y.Doc
   - Add helper methods for Y.Doc conversion

2. **Phase 2**: Refactor property handling
   - Update the `applyProperty` method to detect and handle CRDT properties
   - Implement the Y.Doc to CRDTType conversion
   - Add in-memory storage for active Y.Doc instances

3. **Phase 3**: Update the Yjs observer
   - Modify the observer to create SetVertexProperty operations
   - Ensure proper update handling

4. **Phase 4**: Testing and validation
   - Update existing tests for the new property type
   - Add tests for edge cases (type transitions, etc.)
   - Verify backward compatibility

## Backward Compatibility

To maintain backward compatibility during transition:

1. Add support for detecting and converting Y.Doc properties to CRDTType
2. Provide utility functions to convert between Y.Doc and CRDTType
3. Ensure existing code that expects Y.Doc properties continues to work

## Internal Implementation Details

When working with CRDT properties, RepTree will:

1. Store the serialized CRDTType in operations and for persistence
2. Maintain in-memory Y.Doc instances for active properties
3. Automatically convert between Y.Doc and CRDTType as needed
4. Use the existing property access methods with type detection

## Conclusion

This refactoring approach simplifies how RepTree handles CRDT properties by using a consistent type system and operation model. By replacing direct Y.Doc references with a serializable CRDTType and eliminating the separate ModifyVertexPropertyOp, we can reduce complexity, improve maintainability, and make future extensions easier while maintaining all existing functionality.
