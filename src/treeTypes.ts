import { VertexState } from "./VertexState";

export type TreeVertexId = string;

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