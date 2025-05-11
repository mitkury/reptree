import { VertexState } from "./VertexState";
import * as Y from 'yjs';

export type TreeVertexId = string;

export type VertexPropertyType = string | number | boolean | string[] | number[] | boolean[] | undefined | Y.Doc;

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

