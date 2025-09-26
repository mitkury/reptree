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
});

