import { NodeState } from "./NodeState";

export type TreeNodeId = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Property type for state (undefined means removal) */
export type NodePropertyType = JsonValue | undefined;

export type TreeNodeProperty = {
  readonly key: string;
  readonly value: NodePropertyType;
}

type NodeChangeEventType = 'move' | 'property' | 'children';

export interface NodeChangeEvent {
  type: NodeChangeEventType;
  nodeId: TreeNodeId;
}

export type NodePropertyChangeEvent = NodeChangeEvent & {
  type: 'property';
  key: string;
  value: NodePropertyType | undefined;
}

export type NodeMoveEvent = NodeChangeEvent & {
  type: 'move';
  oldParentId: TreeNodeId | null | undefined;
  newParentId: TreeNodeId;
}

export type NodeChildrenChangeEvent = NodeChangeEvent & {
  type: 'children';
  children: NodeState[];
}

/**
 * Type definition for operation ID range used in state vectors
 */
export interface OpIdRange {
  peerId: string;
  start: number;
  end: number;
}

export type StateVectors = {
  move: Record<string, number[][]>;
  prop: Record<string, number[][]>;
};
