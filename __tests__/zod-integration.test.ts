import { describe, test, expect } from 'vitest';
import { RepTree } from '../dist/index.js';
import { z } from 'zod';

describe('Zod integration with RepTree.parseVertex', () => {
  test('parses valid vertex properties according to schema', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = tree.newVertex(root.id);

    tree.setVertexProperty(v.id, 'name', 'Alice');
    tree.setVertexProperty(v.id, 'age', 30);

    const Person = z.object({
      name: z.string(),
      age: z.number().int().nonnegative(),
    });

    const parsed = tree.parseVertex(v.id, Person);

    expect(parsed.name).toBe('Alice');
    expect(parsed.age).toBe(30);
  });

  test('throws on invalid properties', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = tree.newVertex(root.id);

    tree.setVertexProperty(v.id, 'name', 'Bob');
    // Invalid: age should be a number
    tree.setVertexProperty(v.id, 'age', '31' as unknown as number);

    const Person = z.object({
      name: z.string(),
      age: z.number().int().nonnegative(),
    });

    expect(() => tree.parseVertex(v.id, Person)).toThrowError();
  });
});