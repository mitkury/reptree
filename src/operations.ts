import { OpId } from "./OpId";
import { type VertexPropertyType, YjsUpdate } from "./treeTypes";

export interface MoveVertex {
  id: OpId;
  targetId: string;
  parentId: string | null;
}

export interface SetVertexProperty {
  id: OpId;
  targetId: string;
  key: string;
  value: VertexPropertyType;
  transient: boolean;
}

export interface YjsUpdateOperation {
  id: OpId;
  targetId: string;
  key: string;
  value: YjsUpdate;
}

export type VertexOperation = MoveVertex | SetVertexProperty | YjsUpdateOperation;

export function isMoveVertexOp(op: VertexOperation): op is MoveVertex {
  return 'parentId' in op;
}

export function isSetPropertyOp(op: VertexOperation): op is SetVertexProperty {
  return 'key' in op && 'transient' in op;
}

export function isYjsUpdateOp(op: VertexOperation): op is YjsUpdateOperation {
  return 'key' in op && !('transient' in op) && 
         op.value && typeof op.value === 'object' && 
         (op.value as any)._type === 'yjs-update';
}

export function newMoveVertexOp(clock: number, peerId: string, targetId: string, parentId: string | null): MoveVertex {
  return { id: new OpId(clock, peerId), targetId, parentId };
}

export function newSetVertexPropertyOp(clock: number, peerId: string, targetId: string, key: string, value: VertexPropertyType): SetVertexProperty {
  return { id: new OpId(clock, peerId), targetId, key, value, transient: false };
}

export function newSetTransientVertexPropertyOp(clock: number, peerId: string, targetId: string, key: string, value: VertexPropertyType): SetVertexProperty {
  return { id: new OpId(clock, peerId), targetId, key, value, transient: true };
}

export function newYjsUpdateOp(clock: number, peerId: string, targetId: string, key: string, update: Uint8Array): YjsUpdateOperation {
  return { 
    id: new OpId(clock, peerId), 
    targetId, 
    key, 
    value: {
      _type: 'yjs-update',
      update
    }
  };
}