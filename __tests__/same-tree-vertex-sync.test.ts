import { describe, test, expect } from 'vitest';
import { RepTree } from '../dist/index.js';

/**
 * Ensures that two bound references to the same vertex within the same tree
 * stay in sync when mutated via either reference.
 */
describe('same-tree vertex reference sync', () => {
  test('two bound references reflect each other\'s writes', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = tree.newVertex(root.id);

    const personRef1 = v.bind<{ age: number }>();
    const personRef2 = v.bind<{ age: number }>();

    // Write via the first reference
    personRef1.age = 33;

    // Read via the second reference
    expect(personRef2.age).toBe(33);

    // Sanity: underlying tree reflects the write
    expect(tree.getVertexProperty(v.id, 'age')).toBe(33);

    // Write via the second reference and read via the first
    personRef2.age = 34;
    expect(personRef1.age).toBe(34);
  });
});
