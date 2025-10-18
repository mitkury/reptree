import { VertexState } from "./VertexState";

export type TreeVertexId = string;

/**
 * Serializable CRDT data for operations
 */
// Yjs support was removed in this branch. Only LWW primitives are supported.

/**
 * Property type for state - includes Y.Doc for runtime usage
 */
export type VertexPropertyType = string | number | boolean | string[] | number[] | boolean[] | undefined;

/**
 * Property type for operations - includes CRDTType instead of Y.Doc
 */
// For operations we persist the same primitive types as values (LWW only)
export type VertexPropertyTypeInOperation = VertexPropertyType;

export type TreeVertexProperty = {
  readonly key: string;
  readonly value: VertexPropertyType;
}

type VertexChangeEventType = 'move' | 'property' | 'children';

export interface VertexChangeEvent {
  type: VertexChangeEventType;
  vertexId: TreeVertexId;
}

export type VertexPropertyChangeEvent = VertexChangeEvent & {
  type: 'property';
  key: string;
  value: VertexPropertyType | undefined;
}

export type VertexMoveEvent = VertexChangeEvent & {
  type: 'move';
  oldParentId: TreeVertexId | null | undefined;
  newParentId: TreeVertexId;
}

export type VertexChildrenChangeEvent = VertexChangeEvent & {
  type: 'children';
  children: VertexState[];
}

/**
 * Type definition for operation ID range used in state vectors
 */
export interface OpIdRange {
  peerId: string;
  start: number;
  end: number;
}

