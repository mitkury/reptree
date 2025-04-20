import { VertexState } from "./VertexState";
import * as Y from 'yjs';

export type TreeVertexId = string;

export type YjsUpdate = {
  _type: 'yjs-update';
  update: Uint8Array;  // Binary Yjs update data
}

export type VertexPropertyType = 
  | string 
  | number 
  | boolean 
  | string[] 
  | number[] 
  | boolean[] 
  | undefined
  | Y.Doc;  // Direct Y.Doc support

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