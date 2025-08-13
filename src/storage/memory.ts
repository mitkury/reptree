import type { EncodedVertex, LogStoreLike, VertexStore } from './types';

export class MemoryVertexStore implements VertexStore {
  private vertices = new Map<string, EncodedVertex>();
  private childrenIndex = new Map<string, Array<{ id: string; idx: number }>>();

  async getVertex(id: string): Promise<EncodedVertex | undefined> {
    return this.vertices.get(id);
  }

  async putVertex(v: EncodedVertex): Promise<void> {
    this.vertices.set(v.id, v);

    // Maintain simple index by parent
    const parentId = v.parentId ?? 'null';
    if (!this.childrenIndex.has(parentId)) this.childrenIndex.set(parentId, []);
    const arr = this.childrenIndex.get(parentId)!;

    // Remove previous entry if exists
    const prevIdx = arr.findIndex(e => e.id === v.id);
    if (prevIdx >= 0) arr.splice(prevIdx, 1);

    // Use provided idx or append at the end
    const idx = v.idx ?? arr.length;
    arr.push({ id: v.id, idx });
    arr.sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));
  }

  async getChildrenPage(parentId: string, afterIdx: number | null, limit: number): Promise<Array<{ id: string; idx: number }>> {
    const key = parentId ?? 'null';
    const arr = this.childrenIndex.get(key) ?? [];
    const start = afterIdx == null ? 0 : arr.findIndex(e => e.idx > afterIdx);
    const startIdx = start === -1 ? arr.length : start;
    return arr.slice(startIdx, startIdx + limit);
  }
}

export class MemoryLogStore<T> implements LogStoreLike<T> {
  private seq = 0;
  private items: Array<{ seq: number; value: T }> = [];

  async append(op: T): Promise<number> {
    const s = ++this.seq;
    this.items.push({ seq: s, value: op });
    return s;
  }

  async latestSeq(): Promise<number> {
    return this.seq;
  }

  async *scanRange(opts?: { from?: number; to?: number; limit?: number; reverse?: boolean }): AsyncIterable<T> {
    const from = opts?.from ?? 1;
    const to = opts?.to ?? this.seq;
    const reverse = opts?.reverse ?? false;
    const limit = opts?.limit ?? Number.POSITIVE_INFINITY;

    let count = 0;
    if (!reverse) {
      for (const { seq, value } of this.items) {
        if (seq < from) continue;
        if (seq > to) break;
        yield value;
        if (++count >= limit) break;
      }
    } else {
      for (let i = this.items.length - 1; i >= 0; i--) {
        const { seq, value } = this.items[i];
        if (seq > to) continue;
        if (seq < from) break;
        yield value;
        if (++count >= limit) break;
      }
    }
  }
}