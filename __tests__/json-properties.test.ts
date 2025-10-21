import { describe, test, expect } from 'vitest';
import { RepTree } from '../src';

describe('JSON property values', () => {
  test('sets and gets nested objects and arrays', () => {
    const tree = new RepTree('p1');
    const root = tree.createRoot();
    const v = root.newNamedChild('node');

    v.setProperty('obj', { a: 1, b: { c: [1, 2, { d: true }] } } as any);
    v.setProperty('arr', [1, 2, { k: 'v' }] as any);
    v.setProperty('nil', null as any);

    expect(v.getProperty('obj')).toEqual({ a: 1, b: { c: [1, 2, { d: true }] } });
    expect(v.getProperty('arr')).toEqual([1, 2, { k: 'v' }]);
    expect(v.getProperty('nil')).toBeNull();
  });

  test('replicates JSON values across peers and LWW applies', () => {
    const t1 = new RepTree('A');
    const root = t1.createRoot();
    const v = root.newNamedChild('doc');

    v.setProperty('meta', { version: 1, flags: { archived: false } } as any);
    v.setProperty('meta', { version: 2, flags: { archived: true } } as any);

    const ops = t1.getAllOps();
    const t2 = new RepTree('B');
    t2.merge(ops);

    const v2 = t2.getVertex(v.id)!;
    expect(v2.getProperty('meta')).toEqual({ version: 2, flags: { archived: true } });
  });

  test('normalize props for creation accepts JSON-serializable props', () => {
    const t = new RepTree('N');
    const root = t.createRoot();
    const child = root.newChild({
      name: 'Child',
      data: { a: 1, list: [1, { b: 2 }] },
      empty: {},
      list: [],
      _c: '2024-01-01T00:00:00.000Z',
    } as any);

    expect(child.getProperty('name')).toBe('Child');
    expect(child.getProperty('data')).toEqual({ a: 1, list: [1, { b: 2 }] });
    expect(child.getProperty('empty')).toEqual({});
    expect(child.getProperty('list')).toEqual([]);
  });
});
