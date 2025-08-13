import { describe, test, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  RepTree,
  SqliteVertexStore,
  SqliteJsonLogStore,
  ensureRepTreeSchema,
} from '../dist/index.js';
import * as Y from 'yjs';

function createTreeWithSqlite(db: any, peerId: string, withLogs: boolean, opMemoryLimit?: number) {
  ensureRepTreeSchema(db);
  const opts: any = {
    vertexStore: new SqliteVertexStore(db),
  };
  if (withLogs) {
    opts.moveLog = new SqliteJsonLogStore(db, 'rt_move_ops');
    opts.propLog = new SqliteJsonLogStore(db, 'rt_prop_ops');
  }
  if (opMemoryLimit != null) opts.opMemoryLimit = opMemoryLimit;
  return new RepTree(peerId, opts);
}

describe('SQLite external store integration', () => {
  test('loads many children from SQLite via async methods', async () => {
    const db = new Database(':memory:');

    const treeA = createTreeWithSqlite(db, 'peer1', false);
    const root = treeA.createRoot();

    const totalChildren = 500; // below default page size
    for (let i = 0; i < totalChildren; i++) {
      treeA.newNamedVertex(root.id, `child_${i}`);
    }

    // Create a fresh tree instance with the same SQLite store, empty in-memory state
    const treeB = createTreeWithSqlite(db, 'peer2', false);

    // Verify sync method sees nothing (in-memory cache only)
    expect(treeB.getChildrenIds(root.id).length).toBe(0);

    // Async method should page children from SQLite
    const ids = await treeB.getChildrenIdsAsync(root.id);
    expect(ids.length).toBe(totalChildren);

    const children = await treeB.getChildrenAsync(root.id);
    expect(children.length).toBe(totalChildren);
  });

  test('vector sync using async log loading with eviction', async () => {
    // Three independent peers, each with its own SQLite DB/logs
    const db1 = new Database(':memory:');
    const db2 = new Database(':memory:');
    const db3 = new Database(':memory:');

    const t1 = createTreeWithSqlite(db1, 'p1', true, /*opMemoryLimit*/ 25);
    const t2 = createTreeWithSqlite(db2, 'p2', true, /*opMemoryLimit*/ 25);
    const t3 = createTreeWithSqlite(db3, 'p3', true, /*opMemoryLimit*/ 25);

    // Establish a common root by seeding t2 and t3 from t1
    const r1 = t1.createRoot();
    const baseOps = t1.getAllOps();
    t2.merge(baseOps);
    t3.merge(baseOps);

    // Perform some operations on each tree independently
    const trees = [t1, t2, t3];
    for (const tree of trees) {
      // create
      for (let i = 0; i < 50; i++) {
        const v = tree.newNamedVertex(r1.id, `n_${Math.random().toString(36).slice(2, 8)}`);
        tree.setVertexProperty(v.id, 'kind', 'file');
      }
      // move a few
      const childIds = tree.getChildrenIds(r1.id);
      for (let i = 0; i < 10 && childIds.length > 1; i++) {
        const a = childIds[Math.floor(Math.random() * childIds.length)];
        const b = childIds[Math.floor(Math.random() * childIds.length)];
        if (a !== b) tree.moveVertex(a, b);
      }
    }

    // Synchronize using state vectors and async log streaming
    for (let i = 0; i < trees.length; i++) {
      for (let j = 0; j < trees.length; j++) {
        if (i === j) continue;
        const sv = trees[j].getStateVector();
        if (!sv) continue;
        const missing = await trees[i].getMissingOpsAsync(sv);
        if (missing.length > 0) trees[j].merge(missing);
      }
    }

    // All trees should converge structurally
    expect(t1.compareStructure(t2)).toBe(true);
    expect(t1.compareStructure(t3)).toBe(true);

    const count = t1.getAllVertices().length;
    expect(t2.getAllVertices().length).toBe(count);
    expect(t3.getAllVertices().length).toBe(count);
  });

  test('Yjs property ops stream through SQLite prop log', async () => {
    const db = new Database(':memory:');
    const t1 = createTreeWithSqlite(db, 'p1', true, 10);
    const t2 = createTreeWithSqlite(db, 'p2', true, 10);

    // share root
    const r1 = t1.createRoot();
    t2.merge(t1.getAllOps());

    // set Yjs property on t1
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('default');
    ytext.insert(0, 'Hello');
    t1.setVertexProperty(r1.id, 'content', ydoc);

    // mutate the Y.Doc to emit CRDT updates (and log them)
    const doc1 = t1.getVertexProperty(r1.id, 'content') as Y.Doc;
    const text1 = doc1.getText('default');
    text1.insert(text1.length, ' world');

    // compute and apply missing ops using async log scan
    const sv2 = t2.getStateVector();
    if (sv2) {
      const missing = await t1.getMissingOpsAsync(sv2);
      t2.merge(missing);
    }

    const doc2 = t2.getVertexProperty(r1.id, 'content') as Y.Doc;
    expect(doc2).toBeInstanceOf(Y.Doc);
    expect(doc2.getText('default').toString()).toBe('Hello world');
  });

  test('forces storage fetch when op memory limit is tiny', async () => {
    const db = new Database(':memory:');
    const t1 = createTreeWithSqlite(db, 'p1', true, 3); // tiny window
    const t2 = createTreeWithSqlite(db, 'p2', true, 3);

    // share root
    const r1 = t1.createRoot();
    t2.merge(t1.getAllOps());

    // generate many property ops to exceed memory window
    for (let i = 0; i < 20; i++) {
      t1.setVertexProperty(r1.id, `k`, i);
    }

    // their state vector
    const sv2 = t2.getStateVector()!;

    // Sync-only missing ops are limited to in-memory window
    const missingSync = t1.getMissingOps(sv2);

    // Async should pull from storage and be larger
    const missingAsync = await t1.getMissingOpsAsync(sv2);
    expect(missingAsync.length).toBeGreaterThan(missingSync.length);

    // Apply async missing ops and verify final value
    t2.merge(missingAsync);
    expect(t2.getVertexProperty(r1.id, 'k')).toBe(19);
  });
});