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

export function isLWWPropertyOp(op: VertexOperation): op is SetVertexProperty {
  return 'key' in op && 'value' in op && (!op.value || typeof op.value !== 'object' || !('type' in op.value));
}

export function isModifyPropertyOp(op: VertexOperation): op is SetVertexProperty {
  return 'key' in op && 'value' in op && typeof op.value === 'object' && op.value !== null && 'type' in op.value;
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