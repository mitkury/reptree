import { describe, expect, test } from 'vitest';
import { RepTree } from '../dist/index.js';

describe('RepTree transact()', () => {
  test('success keeps ops and state', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();

    tree.transact(() => {
      const a = root.newNamedChild('A');
      const b = a.newNamedChild('B');
      const c = b.newNamedChild('C');
      c.setProperty('hello', 'world');
    });

    // State should reflect changes
    const a = root.children.find(v => v.name === 'A');
    expect(a).toBeTruthy();
    const b = a!.children.find(v => v.name === 'B');
    expect(b).toBeTruthy();
    const c = b!.children.find(v => v.name === 'C');
    expect(c).toBeTruthy();
    expect(c!.getProperty('hello')).toBe('world');

    // Ops should be present
    const ops = tree.getAllOps();
    expect(ops.length).toBeGreaterThan(0);
  });

  test('throw rolls back state and drops ops', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();

    const beforeOps = tree.getAllOps().length;

    try {
      tree.transact(() => {
        const a = root.newNamedChild('A');
        const b = a.newNamedChild('B');
        const c = b.newNamedChild('C');
        c.setProperty('hello', 'world');
        throw new Error('nope');
      });
    } catch {}

    // State should not contain A/B/C
    expect(root.children.find(v => v.name === 'A')).toBeUndefined();

    // Ops should be unchanged from before
    const afterOps = tree.getAllOps().length;
    expect(afterOps).toBe(beforeOps);
  });

  test('property changes restore previous values on rollback', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const a = root.newNamedChild('A');
    a.setProperty('x', 1);
    const beforeOps = tree.getAllOps().length;

    try {
      tree.transact(() => {
        a.setProperty('x', 2);
        a.setProperty('x', 3);
        throw new Error('revert');
      });
    } catch {}

    expect(a.getProperty('x')).toBe(1);
    expect(tree.getAllOps().length).toBe(beforeOps);
  });

  test('move rollback restores previous parent', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const a = root.newNamedChild('A');
    const b = root.newNamedChild('B');
    const child = a.newNamedChild('child');
    const beforeOps = tree.getAllOps().length;

    try {
      tree.transact(() => {
        child.moveTo(b);
        throw new Error('nope');
      });
    } catch {}

    // Child should still be under A
    expect(a.children.map(v => v.id)).toContain(child.id);
    expect(b.children.map(v => v.id)).not.toContain(child.id);
    expect(tree.getAllOps().length).toBe(beforeOps);
  });

  test('complex: pre/post equality on cancel and future ops validity', () => {
    const pre = new RepTree('peer1');
    const root = pre.createRoot();
    const proj = root.newNamedChild('Project');
    const docs = proj.newNamedChild('Docs');
    docs.setProperties({ type: 'folder' });
    const img = proj.newNamedChild('Images');
    const logo = img.newNamedChild('logo.png');
    logo.setProperties({ type: 'file', size: 1 });

    // Snapshot baseline ops and structure
    const baselineOps = pre.getAllOps();
    const baselineClone = pre.replicate('peer2');
    expect(pre.compareStructure(baselineClone)).toBe(true);

    // Perform a transaction and cancel
    try {
      pre.transact(() => {
        const readme = docs.newNamedChild('README.md');
        readme.setProperties({ type: 'file', size: 2048 });
        logo.moveTo(docs);
        proj.setProperty('updated', true);
        throw new Error('cancel');
      });
    } catch {}

    // After cancel, tree should match baseline structure
    const afterCancel = pre.replicate('peer3');
    expect(pre.compareStructure(baselineClone)).toBe(true);
    expect(pre.compareStructure(afterCancel)).toBe(true);

    // Future ops: apply same new ops to both baseline clone and the canceled tree
    const applyFutureOps = (t: RepTree) => {
      const r = t.root!;
      const p = r.children.find(v => v.name === 'Project')!;
      const d = p.children.find(v => v.name === 'Docs')!;
      const i = p.children.find(v => v.name === 'Images')!;
      const l = i.children.find(v => v.name === 'logo.png')!;
      const readme = d.newNamedChild('README.md');
      // Normalize createdAt to a constant to make structures strictly comparable across runs
      readme.setProperty('_c', '2000-01-01T00:00:00.000Z');
      readme.setProperties({ type: 'file', size: 2048 });
      l.moveTo(d);
      p.setProperty('updated', true);
    };

    const canceledTree = pre;
    const baselineTree = baselineClone;
    // Apply future ops to baseline and replicate exact ops to canceledTree
    applyFutureOps(baselineTree);
    const newOps = baselineTree.popLocalOps();
    canceledTree.merge(newOps);

    // The two trees should converge to the same structure
    expect(canceledTree.compareStructure(baselineTree)).toBe(true);

    // And ops list length parity indicates no leakage on cancel path
    expect(canceledTree.getAllOps().length).toBe(baselineTree.getAllOps().length);
  });
});

