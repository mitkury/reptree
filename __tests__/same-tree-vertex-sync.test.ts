import { describe, test, expect } from 'vitest';
import { RepTree, bindVertex } from '../dist/index.js';

/**
 * Ensures that two bound references to the same vertex within the same tree
 * stay in sync when mutated via either reference.
 */
describe('same-tree vertex reference sync', () => {
  test('two bound references reflect each other\'s writes', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = tree.newVertex(root.id);

    const personRef1 = bindVertex(tree, v.id);
    const personRef2 = bindVertex(tree, v.id);

    // Write via the first reference
    personRef1['age' as keyof typeof personRef1] = 33 as any;

    // Read via the second reference
    const age2 = personRef2['age' as keyof typeof personRef2] as unknown as number;
    expect(age2).toBe(33);

    // Sanity: underlying tree reflects the write
    expect(tree.getVertexProperty(v.id, 'age')).toBe(33);

    // Write via the second reference and read via the first
    personRef2['age' as keyof typeof personRef2] = 34 as any;
    const age1 = personRef1['age' as keyof typeof personRef1] as unknown as number;
    expect(age1).toBe(34);
  });
});
