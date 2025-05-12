# CRDT Property Type Refactoring Proposal

Date: 2025-05-12

## Overview

This proposal outlines a refactoring approach to simplify how RepTree handles CRDT-based properties (specifically Yjs documents). The core idea is to keep the existing `SetVertexProperty` operation but modify the `VertexPropertyType` to include a serializable `CRDTType` instead of directly using `Y.Doc`. When applying operations, RepTree will detect CRDT properties and apply updates using the appropriate CRDT mechanism rather than Last-Writer-Wins (LWW).

The key insight is to maintain different types for property values in operations versus the state:
- In the state (what users interact with): `vertex.getProperty('some-doc')` returns a `Y.Doc` object via `VertexPropertyType`
- In operations: Store `CRDTType` with serialized `Uint8Array` via `VertexPropertyTypeInOperation`

### Dual Representation Approach

This approach creates a dual representation system:

1. **User-Facing API**: Users work with actual `Y.Doc` objects when getting/setting properties
   ```typescript
   // User sets a Y.Doc directly
   const ydoc = new Y.Doc();
   tree.setVertexProperty(vertexId, 'content', ydoc);
   
   // User gets back a Y.Doc directly
   const doc = tree.getVertexProperty(vertexId, 'content'); // Returns Y.Doc
   ```

2. **Internal Operation Storage**: Operations use `VertexPropertyTypeInOperation` with `CRDTType`
   ```typescript
   // Internal operation representation
   const op = {
     id: new OpId(clock, peerId),
     targetId: vertexId,
     key: 'content',
     value: {
       type: 'yjs',
       value: Uint8Array // Serialized Y.Doc state
     } as CRDTType,
     transient: false
   };
   ```

This separation simplifies both the user experience and the internal operation model.

### Y.Doc Storage in VertexState

A key aspect of this implementation is how Y.Doc instances are stored:

1. **Using Existing Property Storage**: Y.Doc instances will be stored directly in the `properties` array of `VertexState` class:
   ```typescript
   // In VertexState.ts
   private properties: TreeVertexProperty[];
   ```

2. **No Separate Map Needed**: Unlike the previous implementation, we don't need a separate `activeYDocs` map to store Y.Doc instances. The standard property access mechanisms will work for both regular properties and Y.Doc properties.

3. **Type Conversion During Operation Creation**: When creating operations, we'll convert between types:
   ```typescript
   // When creating an operation
   let opValue: VertexPropertyTypeInOperation;
   
   if (value instanceof Y.Doc) {
     // Convert Y.Doc to CRDTType for operation
     const state = Y.encodeStateAsUpdate(value);
     opValue = {
       type: "yjs",
       value: state
     };
   } else {
     // Regular values pass through unchanged
     opValue = value;
   }
   ```

4. **Transparent Property Access**: From the user's perspective, getting a property that contains a Y.Doc will work seamlessly through the standard `getVertexProperty` method without any special handling.

### Operation Application and Type Conversion

When applying operations, we need to handle the conversion between serialized CRDTType and Y.Doc:

1. **Initial Y.Doc Creation**: When an operation with a CRDTType is received:
   ```typescript
   if (value && typeof value === 'object' && 'type' in value && value.type === 'yjs') {
     const crdtValue = value as CRDTType;
     
     // Create new Y.Doc from the serialized data
     const newDoc = new Y.Doc();
     Y.applyUpdate(newDoc, crdtValue.value);
     
     // Store the Y.Doc in the vertex property (VertexPropertyType)
     this.setPropertyValue(targetId, key, newDoc, transient);
   }
   ```

2. **Updating Existing Y.Doc**: When an update to an existing Y.Doc property is received:
   ```typescript
   const currentProperty = this.getVertexProperty(targetId, key);
   if (currentProperty instanceof Y.Doc) {
     // Apply update to existing Y.Doc
     Y.applyUpdate(currentProperty, crdtValue.value, 'reptree');
     // No need to update the property reference since we modified the existing Y.Doc
   }
   ```

3. **Serialization for Sync**: When synchronizing between peers, we'll serialize Y.Doc properties to CRDTType:
   ```typescript
   // When preparing operations for sync
   const ops = this.getAllOps();
   // The operations already contain serialized CRDTType values
   // No additional conversion needed for sync
   ```

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

### 1. Separate Property Type Systems

Create separate union types for operations versus property state:

```typescript
// New CRDTType for serializable CRDT data in operations
export interface CRDTType {
  type: string;           // e.g., "yjs"
  value: Uint8Array;      // Serialized CRDT state
}

// Type for property values in operations
export type VertexPropertyTypeInOperation = 
  | string 
  | number 
  | boolean 
  | string[] 
  | number[] 
  | boolean[] 
  | undefined
  | CRDTType;  // For CRDT data in operations

// Type for property values in state (unchanged)
export type VertexPropertyType = 
  | string 
  | number 
  | boolean 
  | string[] 
  | number[] 
  | boolean[] 
  | undefined
  | Y.Doc;  // Actual Y.Doc objects in state
```

### 2. Update SetVertexProperty to Use Operation-Specific Type

Modify the `SetVertexProperty` operation to use the new operation-specific property type:

```typescript
export interface SetVertexProperty {
  id: OpId;
  targetId: string;
  key: string;
  value: VertexPropertyTypeInOperation; // Uses operation-specific type
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
    
    if (crdtValue.type === "yjs") {
      if (currentProperty instanceof Y.Doc) {
        // Apply update to existing Y.Doc
        Y.applyUpdate(currentProperty, crdtValue.value, 'reptree');
        // No need to update the property since we modified it in place
      } else {
        // Create new Y.Doc if property doesn't exist or isn't a Y.Doc
        const newDoc = new Y.Doc();
        Y.applyUpdate(newDoc, crdtValue.value);
        
        // Store the Y.Doc in the vertex property
        this.setPropertyValue(targetId, key, newDoc, transient);
        
        // Set up observer for the new Y.Doc
        this.setupYjsObserver(newDoc, targetId, key);
      }
    }
  } else {
    // Handle primitive property types (standard LWW behavior)
    this.setPropertyValue(targetId, key, value, transient);
  }
}

// No longer needed - properties in state are already Y.Doc instances
// and properties in operations are CRDTType
```

### 4. Y.Doc to CRDTType Conversion

When setting a Y.Doc property, the system will automatically convert it to a CRDTType:

```typescript
setVertexProperty(vertexId: string, key: string, value: VertexPropertyType) {
  let opValue: VertexPropertyTypeInOperation;
  
  // Convert Y.Doc to CRDTType for operation
  if (value instanceof Y.Doc) {
    // Create a CRDTType from the Y.Doc
    const state = Y.encodeStateAsUpdate(value);
    opValue = {
      type: "yjs",
      value: state
    };
    
    // Set up observer for future changes
    this.setupYjsObserver(value, vertexId, key);
  } else {
    // Regular values pass through unchanged
    opValue = value;
  }
  
  // Create the standard SetVertexProperty operation
  const op = newSetVertexPropertyOp(
    this.lamportClock++,
    this.peerId,
    vertexId,
    key,
    opValue
  );
  
  this.localOps.push(op);
  this.applyProperty(op);
}

// Helper method to get a Y.Doc from a property
getVertexPropertyAsYDoc(vertexId: string, key: string): Y.Doc | null {
  const property = this.getVertexProperty(vertexId, key);
  // Since VertexPropertyType includes Y.Doc, we just need to check the type
  return property instanceof Y.Doc ? property : null;
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
