import type { VertexStore, EncodedVertex, LogStoreLike } from './types';

/**
 * Minimal DB interface subset to avoid hard dependency on a specific sqlite library.
 * Works with better-sqlite3 Database or similar async wrappers when methods are present.
 */
type SQLiteLike = any; // use `any` to avoid requiring type packages

export function ensureRepTreeSchema(db: SQLiteLike) {
  // Run DDL (no-ops if already exists)
  db.prepare(
    `CREATE TABLE IF NOT EXISTS rt_vertices(
       id TEXT PRIMARY KEY,
       parent_id TEXT,
       idx INT,
       payload BLOB
     );`
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS rt_vertices_pidx
       ON rt_vertices(parent_id, idx);`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS rt_move_ops(
       seq INTEGER PRIMARY KEY AUTOINCREMENT,
       op  TEXT NOT NULL
     );`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS rt_prop_ops(
       seq INTEGER PRIMARY KEY AUTOINCREMENT,
       op  TEXT NOT NULL
     );`
  ).run();
}

export class SqliteVertexStore implements VertexStore {
  constructor(private db: SQLiteLike) {}

  async getVertex(id: string): Promise<EncodedVertex | undefined> {
    const row = this.db.prepare(
      `SELECT id, parent_id as parentId, idx, payload FROM rt_vertices WHERE id = ?`
    ).get(id);
    if (!row) return undefined;
    return row as EncodedVertex;
  }

  async putVertex(v: EncodedVertex): Promise<void> {
    this.db.prepare(
      `INSERT INTO rt_vertices (id, parent_id, idx, payload)
       VALUES (@id, @parentId, @idx, @payload)
       ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id,
                                    idx = excluded.idx,
                                    payload = excluded.payload`
    ).run({ id: v.id, parentId: v.parentId, idx: v.idx ?? null, payload: v.payload ?? null });
  }

  async getChildrenPage(parentId: string, afterIdx: number | null, limit: number): Promise<Array<{ id: string; idx: number }>> {
    const rows = this.db.prepare(
      `SELECT id, idx FROM rt_vertices
       WHERE parent_id = ? AND (? IS NULL OR idx > ?)
       ORDER BY idx ASC
       LIMIT ?`
    ).all(parentId, afterIdx, afterIdx, limit);
    return rows.map((r: any) => ({ id: r.id as string, idx: (r.idx as number) ?? 0 }));
  }
}

export class SqliteJsonLogStore<T> implements LogStoreLike<T> {
  constructor(private db: SQLiteLike, private table: 'rt_move_ops' | 'rt_prop_ops') {}

  async append(op: T): Promise<number> {
    const info = this.db.prepare(
      `INSERT INTO ${this.table} (op) VALUES (?)`
    ).run(JSON.stringify(op));
    // better-sqlite3 returns { lastInsertRowid }
    return Number(info.lastInsertRowid ?? 0);
  }

  async latestSeq(): Promise<number> {
    const row = this.db.prepare(
      `SELECT COALESCE(MAX(seq), 0) as maxSeq FROM ${this.table}`
    ).get();
    return Number(row?.maxSeq ?? 0);
  }

  async *scanRange(opts?: { from?: number; to?: number; limit?: number; reverse?: boolean }): AsyncIterable<T> {
    const from = opts?.from ?? 1;
    const to = opts?.to ?? Number.MAX_SAFE_INTEGER;
    const limit = opts?.limit ?? Number.MAX_SAFE_INTEGER;
    const reverse = opts?.reverse ?? false;

    const order = reverse ? 'DESC' : 'ASC';
    const stmt = this.db.prepare(
      `SELECT seq, op FROM ${this.table}
       WHERE seq >= ? AND seq <= ?
       ORDER BY seq ${order}
       LIMIT ?`
    );

    const rows = stmt.all(from, to, limit) as Array<{ seq: number; op: string }>;
    for (const row of rows) {
      try {
        yield JSON.parse(row.op) as T;
      } catch {
        // skip invalid rows
      }
    }
  }
}