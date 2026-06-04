import { type OpId, createOpId } from "./OpId";
import { type NodePropertyType } from "./treeTypes";

export interface MoveNode {
  id: OpId;
  targetId: string;
  parentId: string | null;
}

export interface SetNodeProperty {
  id: OpId;
  targetId: string;
  key: string;
  value: NodePropertyType;
  transient: boolean;
}

export type NodeOperation = MoveNode | SetNodeProperty;

export function isMoveNodeOp(op: NodeOperation): op is MoveNode {
  return 'parentId' in op;
}

export function isAnyPropertyOp(op: NodeOperation): op is SetNodeProperty {
  return 'key' in op;
}

export function newMoveNodeOp(clock: number, peerId: string, targetId: string, parentId: string | null): MoveNode {
  return { id: createOpId(clock, peerId), targetId, parentId };
}

export function newSetNodePropertyOp(clock: number, peerId: string, targetId: string, key: string, value: NodePropertyType): SetNodeProperty {
  return { id: createOpId(clock, peerId), targetId, key, value, transient: false };
}

export function newSetTransientNodePropertyOp(clock: number, peerId: string, targetId: string, key: string, value: NodePropertyType): SetNodeProperty {
  return { id: createOpId(clock, peerId), targetId, key, value, transient: true };
}