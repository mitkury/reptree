export interface EncodedVertex {
  id: string;
  parentId: string | null;
  idx?: number | null;
  payload?: Uint8Array | string | null;
}

export interface VertexStore {
  getVertex(id: string): Promise<EncodedVertex | undefined>;
  putVertex(v: EncodedVertex): Promise<void>;
  getChildrenPage(parentId: string, afterIdx: number | null, limit: number): Promise<Array<{ id: string; idx: number }>>;
}

export interface LogStoreLike<T> {
  append(op: T): Promise<number>; // returns seq number
  latestSeq(): Promise<number>;
  scanRange(opts?: { from?: number; to?: number; limit?: number; reverse?: boolean }): AsyncIterable<T>;
}

// Re-export generics for clarity in other modules
export type MoveLogStore<T> = LogStoreLike<T>;
export type PropLogStore<T> = LogStoreLike<T>;