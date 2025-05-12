import { OpId } from "./OpId";
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

export interface ModifyVertexPropertyOp {
  id: OpId;
  targetId: string;
  key: string;
  crdtType: string;  // e.g., "yjs"
  value: Uint8Array;  // Binary CRDT update data
  transient: boolean;
}

export type VertexOperation = MoveVertex | SetVertexProperty | ModifyVertexPropertyOp;

export function isMoveVertexOp(op: VertexOperation): op is MoveVertex {
  return 'parentId' in op;
}

export function isSetPropertyOp(op: VertexOperation): op is SetVertexProperty {
  return 'key' in op && 'value' in op && !('crdtType' in op);
}

export function isModifyPropertyOp(op: VertexOperation): op is ModifyVertexPropertyOp {
  return 'key' in op && 'crdtType' in op;
}

export function newMoveVertexOp(clock: number, peerId: string, targetId: string, parentId: string | null): MoveVertex {
  return { id: new OpId(clock, peerId), targetId, parentId };
}

export function newSetVertexPropertyOp(clock: number, peerId: string, targetId: string, key: string, value: VertexPropertyTypeInOperation): SetVertexProperty {
  return { id: new OpId(clock, peerId), targetId, key, value, transient: false };
}

export function newSetTransientVertexPropertyOp(clock: number, peerId: string, targetId: string, key: string, value: VertexPropertyTypeInOperation): SetVertexProperty {
  return { id: new OpId(clock, peerId), targetId, key, value, transient: true };
}

export function newModifyVertexPropertyOp(
  clock: number, 
  peerId: string, 
  targetId: string, 
  key: string, 
  crdtType: string,
  value: Uint8Array,
  transient: boolean = false
): ModifyVertexPropertyOp {
  return { 
    id: new OpId(clock, peerId), 
    targetId, 
    key, 
    crdtType, 
    value, 
    transient 
  };
}