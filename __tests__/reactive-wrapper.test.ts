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

    expect(tree.getVertexProperty(v.id, '_n')).toBe('Alice');
    expect(tree.getVertexProperty(v.id, 'age')).toBe(30);

    // update via CRDT -> reflected on reads (use internal key)
    tree.setVertexProperty(v.id, '_n', 'Bob');
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

    expect(tree.getVertexProperty(v.id, '_n')).toBe('Alice');
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

    expect(tree.getVertexProperty(v.id, '_n')).toBe('Carol');
    expect(tree.getVertexProperty(v.id, 'age')).toBe(28);

    tree.setVertexProperty(v.id, '_n', 'Dave');
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

    expect(tree.getVertexProperty(v.id, '_n')).toBe('Eve');
    expect(tree.getVertexProperty(v.id, 'age')).toBe(41);

    expect(() => (person.age = -5 as any)).toThrowError();
  });

  test('aliases: name <-> _n and createdAt <-> _c with Date conversion', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = tree.newVertex(root.id);

    const Person = z.object({
      name: z.string(),
      age: z.number().int().min(0),
      createdAt: z.date().optional(),
    });

    const person = v.bind(Person);

    // Write public keys -> stored as internal
    const now = new Date('2025-01-01T00:00:00.000Z');
    person.name = 'Frank' as any;
    person.age = 20 as any;
    person.createdAt = now as any;

    expect(tree.getVertexProperty(v.id, '_n')).toBe('Frank');
    expect(tree.getVertexProperty(v.id, 'age')).toBe(20);
    expect(tree.getVertexProperty(v.id, '_c')).toBe(now.toISOString());

    // Read public keys -> converted from internal
    const name = person['name' as keyof typeof person] as unknown as string;
    const createdAt = person['createdAt' as keyof typeof person] as unknown as Date;
    expect(name).toBe('Frank');
    expect(createdAt instanceof Date).toBe(true);
    expect(createdAt.toISOString()).toBe(now.toISOString());

    // Deleting alias keys clears internal
    delete (person as any).name;
    expect(tree.getVertexProperty(v.id, '_n')).toBeUndefined();
  });

  test('newChild props alias resolution and type filtering', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();

    const child = root.newChild({
      name: 'ChildA',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      age: 5,
      flags: [true, false],
      badObj: { nested: true } as any,
      badArr: [1, { x: 1 }] as any,
      undef: undefined,
    } as any);

    expect(child.getProperty('_n')).toBe('ChildA');
    expect(child.getProperty('_c')).toBe('2024-01-01T00:00:00.000Z');
    expect(child.getProperty('age')).toBe(5);
    expect(child.getProperty('flags')).toEqual([true, false]);
    expect(child.getProperty('badObj')).toBeUndefined();
    expect(child.getProperty('badArr')).toBeUndefined();
    expect(child.getProperty('undef')).toBeUndefined();
  });

  test('newNamedChild ignores props.name in favor of explicit name and forbids nested children', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();

    const child = root.newNamedChild('Explicit', { name: 'Ignored', age: 1 } as any);
    expect(child.getProperty('_n')).toBe('Explicit');
    expect(child.getProperty('age')).toBe(1);

    expect(() => root.newChild({ children: [] } as any)).toThrowError();
    expect(() => root.newNamedChild('X', { children: [] } as any)).toThrowError();
  });

  test('whole-object validation uses public keys for aliases', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = tree.newVertex(root.id);

    const Person = z.object({
      name: z.string(),
      age: z.number().int().min(0),
      createdAt: z.date(),
    });

    const person = v.bind(Person);

    // Invalid: createdAt must be a Date
    expect(() => {
      (person as any).createdAt = 'not-a-date';
    }).toThrowError();

    // Valid path
    const now = new Date('2025-01-02T00:00:00.000Z');
    person.name = 'Gina' as any;
    person.age = 44 as any;
    person.createdAt = now as any;

    expect(tree.getVertexProperty(v.id, '_n')).toBe('Gina');
    expect(tree.getVertexProperty(v.id, '_c')).toBe(now.toISOString());
  });

  test('commitTransients promotes previous transient writes to persistent', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = tree.newVertex(root.id);

    const Person = z.object({
      name: z.string(),
      age: z.number().int().min(0),
      createdAt: z.date().optional(),
    });

    const person = bindVertex(tree, v.id, Person);

    // Transient edits first
    const when = new Date('2025-01-03T00:00:00.000Z');
    person.useTransient(p => {
      p.name = 'Draft' as any;
      p.age = 25 as any;
      p.createdAt = when as any;
    });

    // Reads reflect transient overlay (with alias conversion for createdAt)
    expect(person.name).toBe('Draft');
    expect(person.age).toBe(25);
    const createdAt = person['createdAt' as keyof typeof person] as unknown as Date;
    expect(createdAt instanceof Date).toBe(true);
    expect(createdAt.toISOString()).toBe(when.toISOString());

    // Underlying persistent values haven't been set yet (except _c which is created at creation time)
    expect(tree.getVertexProperty(v.id, '_n', false)).toBeUndefined();
    expect(tree.getVertexProperty(v.id, 'age', false)).toBeUndefined();

    // Promote transients -> persist them
    person.commitTransients();
    expect(tree.getVertexProperty(v.id, '_n', false)).toBe('Draft');
    expect(tree.getVertexProperty(v.id, 'age', false)).toBe(25);
    // createdAt persisted as ISO
    expect(tree.getVertexProperty(v.id, '_c', false)).toBe(when.toISOString());
  });
});