import { type OpId, createOpId } from "./OpId";
import { type VertexPropertyTypeInOperation } from "./treeTypes";

export interface MoveVertex {
  id: OpId;
  targetId: string;
  parentId: string | null;
}

export interface SetVertexProperty {
  id: OpId;
  targetId: string;
  key: string;
  value: VertexPropertyTypeInOperation;
  transient: boolean;
}

export type VertexOperation = MoveVertex | SetVertexProperty;

export function isMoveVertexOp(op: VertexOperation): op is MoveVertex {
  return 'parentId' in op;
}

export function isAnyPropertyOp(op: VertexOperation): op is SetVertexProperty {
  return 'key' in op;
}

export function newMoveVertexOp(clock: number, peerId: string, targetId: string, parentId: string | null): MoveVertex {
  return { id: createOpId(clock, peerId), targetId, parentId };
}

export function newSetVertexPropertyOp(clock: number, peerId: string, targetId: string, key: string, value: VertexPropertyTypeInOperation): SetVertexProperty {
  return { id: createOpId(clock, peerId), targetId, key, value, transient: false };
}

export function newSetTransientVertexPropertyOp(clock: number, peerId: string, targetId: string, key: string, value: VertexPropertyTypeInOperation): SetVertexProperty {
  return { id: createOpId(clock, peerId), targetId, key, value, transient: true };
}