# Property Type Protection in RepTree

Date: 2025-04-22

## Overview

This specification defines a type protection mechanism for RepTree properties to prevent accidental type changes and ensure consistent behavior across peers. The proposal introduces a "first-writer-wins" approach to property types, where the type of a property (once established) cannot be changed.

## Problem Statement

In a distributed system with multiple peers making concurrent changes, property type consistency is essential. Without type protection, several problematic scenarios can occur:

1. **Type Inconsistency**: A property could be treated as different types on different peers
2. **Data Loss**: Converting from one type to another can result in loss of information
3. **Runtime Errors**: Code expecting one type might receive another type
4. **CRDT Confusion**: Special types like CRDTs (Y.Doc) require consistent handling

In particular, CRDT properties (like those using Yjs) operate differently from primitive types, as they have their own internal CRDT mechanisms for handling concurrent changes.

## First-Writer-Wins Type Protection

We propose a "first-writer-wins" approach for property types:

### Key Principles

1. **Type Establishment**:
   - The first operation that creates a property establishes its type
   - This type (e.g., string, number, Y.Doc, etc.) becomes fixed for the property's lifetime
   - RepTree tracks which operation established each property's type

2. **Type Immutability**:
   - Once a property's type is established, it cannot be changed
   - Operations that would change the type are ignored, regardless of Lamport clock values
   - Same-type updates continue to follow normal last-writer-wins semantics

3. **Type Categories**:
   - For simplicity, we distinguish between two main type categories:
     - Primitive types (string, number, boolean, etc.)
     - CRDT types (Y.Doc and potential future CRDT implementations)
   - Type protection ensures these categories don't mix

### Conflict Resolution

When type conflicts occur:

1. **Detection**:
   - A type conflict is detected when an operation attempts to set a property to a different type
   - Example: Property "name" was established as a string, but a new operation tries to set it to a Y.Doc

2. **Resolution**:
   - The conflicting operation is ignored (silently rejected)
   - The property retains its original type and value
   - A warning is logged for debugging purposes

3. **Special Case - CRDT Updates**:
   - Update operations for CRDT properties (like Y.Doc updates) are only valid if the property is already that CRDT type
   - If an update operation arrives for a property that isn't the correct CRDT type, it's ignored

## Implementation Considerations

When implementing this approach:

1. **Leveraging Existing Lamport Clock**:
   - We can leverage the existing Lamport clock mechanism to determine "first writer"
   - For type conflicts, we reject operations with higher Lamport clock values
   - For same-type operations, we continue using LWW (higher Lamport clock wins)
   - No need to explicitly track which operation established the type

2. **Peer Consistency**:
   - All peers must implement identical type protection logic
   - This ensures consistent behavior when handling the same set of operations

3. **Performance**:
   - Type checking adds minimal overhead
   - The benefits of type stability outweigh the performance cost

4. **Migration**:
   - For existing deployments without type protection, the first received operation after upgrade establishes the type

## Benefits

This type protection mechanism provides several benefits:

1. **Data Integrity**: Prevents accidental loss of data through type changes
2. **Predictable Behavior**: Ensures consistent handling of properties across all peers
3. **Developer Experience**: Reduces unexpected type-related errors
4. **CRDT Compatibility**: Ensures special CRDT properties maintain their collaborative behavior

## Future Extensions

This proposal can be extended to:

1. **Finer-Grained Type Tracking**: Track specific types rather than just CRDT vs. non-CRDT
2. **Type Transformation**: Add explicit type conversion operations when needed
3. **Schema Validation**: Extend to full schema validation for properties 