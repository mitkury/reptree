import { describe, test, expect } from 'vitest';
import { RepTree, bindVertex } from '../dist/index.js';
import { z } from 'zod';

describe('bindVertex reactive wrapper', () => {
  test('reflects live state and persists writes (no schema)', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = tree.newVertex(root.id);

    const person = bindVertex(tree, v.id);

    // write via object -> persists to CRDT
    person['name' as keyof typeof person] = 'Alice' as any;
    person['age' as keyof typeof person] = 30 as any;

    expect(tree.getVertexProperty(v.id, 'name')).toBe('Alice');
    expect(tree.getVertexProperty(v.id, 'age')).toBe(30);

    // update via CRDT -> reflected on reads
    tree.setVertexProperty(v.id, 'name', 'Bob');
    expect(person['name' as keyof typeof person]).toBe('Bob');
  });

  test('validates writes when schema provided', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = tree.newVertex(root.id);

    const Person = z.object({
      name: z.string(),
      age: z.number().int().min(0),
    });

    const person = bindVertex(tree, v.id, Person);

    person.name = 'Alice' as any;
    person.age = 33 as any;

    expect(tree.getVertexProperty(v.id, 'name')).toBe('Alice');
    expect(tree.getVertexProperty(v.id, 'age')).toBe(33);

    expect(() => (person.age = -1 as any)).toThrowError();
  });

  test('Vertex.bind returns reactive object (no schema)', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = tree.newVertex(root.id);

    const person = v.bind();

    person['name' as keyof typeof person] = 'Carol' as any;
    person['age' as keyof typeof person] = 28 as any;

    expect(tree.getVertexProperty(v.id, 'name')).toBe('Carol');
    expect(tree.getVertexProperty(v.id, 'age')).toBe(28);

    tree.setVertexProperty(v.id, 'name', 'Dave');
    expect(person['name' as keyof typeof person]).toBe('Dave');
  });

  test('Vertex.bind validates writes with schema', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = tree.newVertex(root.id);

    const Person = z.object({
      name: z.string(),
      age: z.number().int().min(0),
    });

    const person = v.bind(Person);

    person.name = 'Eve' as any;
    person.age = 41 as any;

    expect(tree.getVertexProperty(v.id, 'name')).toBe('Eve');
    expect(tree.getVertexProperty(v.id, 'age')).toBe(41);

    expect(() => (person.age = -5 as any)).toThrowError();
  });
});