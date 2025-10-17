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

    person.name = 'Alice';
    person.age = 33;

    expect(tree.getVertexProperty(v.id, '_n')).toBe('Alice');
    expect(tree.getVertexProperty(v.id, 'age')).toBe(33);

    expect(() => (person.age = -1)).toThrowError();
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
    expect(person.name).toBe('Dave');
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

    // NOTE: Delete operator doesn't work with schema vertices (Svelte compatibility trade-off)
    // Schema vertices return a plain object (not Proxy) to work with Svelte's $state()
    // Workaround: Set to undefined instead: person.name = undefined
    // delete (person as any).name;
    // expect(tree.getVertexProperty(v.id, '_n')).toBeUndefined();
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
    person.name = 'Gina';
    person.age = 44;
    person.createdAt = now;

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
    person.$useTransient(p => {
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
    person.$commitTransients();
    expect(tree.getVertexProperty(v.id, '_n', false)).toBe('Draft');
    expect(tree.getVertexProperty(v.id, 'age', false)).toBe(25);
    // createdAt persisted as ISO
    expect(tree.getVertexProperty(v.id, '_c', false)).toBe(when.toISOString());
  });

  test('structural properties with $ prefix', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const parent = tree.newVertex(root.id);
    const child1 = tree.newVertex(parent.id);
    const child2 = tree.newVertex(parent.id);

    const Person = z.object({
      name: z.string(),
      age: z.number(),
    });

    const boundParent = bindVertex(tree, parent.id, Person);

    // Test $id
    expect(boundParent.$id).toBe(parent.id);

    // Test $parentId
    expect(boundParent.$parentId).toBe(root.id);

    // Test $parent
    const p = boundParent.$parent;
    expect(p).toBeDefined();
    expect(p?.id).toBe(root.id);

    // Test $children
    const children = boundParent.$children;
    expect(children.length).toBe(2);
    expect(children[0].id).toBe(child1.id);
    expect(children[1].id).toBe(child2.id);

    // Test $childrenIds
    const childrenIds = boundParent.$childrenIds;
    expect(childrenIds).toEqual([child1.id, child2.id]);

    // Ensure structural properties cannot be set
    (boundParent as any).$id = 'newId';
    expect(boundParent.$id).toBe(parent.id); // unchanged

    (boundParent as any).$parentId = 'newParentId';
    expect(boundParent.$parentId).toBe(root.id); // unchanged
  });

  test('root vertex structural properties', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();

    const boundRoot = bindVertex(tree, root.id);

    // Root has no parent
    expect(boundRoot.$parentId).toBeNull();
    expect(boundRoot.$parent).toBeUndefined();

    // Root can have children
    expect(boundRoot.$children).toEqual([]);
    expect(boundRoot.$childrenIds).toEqual([]);
  });

  test('structural methods: $moveTo', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const parent1 = tree.newVertex(root.id);
    const parent2 = tree.newVertex(root.id);
    const child = tree.newVertex(parent1.id);

    const boundChild = bindVertex(tree, child.id);

    // Initially under parent1
    expect(boundChild.$parentId).toBe(parent1.id);

    // Move to parent2 using Vertex instance
    boundChild.$moveTo(parent2);
    expect(boundChild.$parentId).toBe(parent2.id);
    expect(parent2.childrenIds).toContain(child.id);
    expect(parent1.childrenIds).not.toContain(child.id);

    // Move to root using bound vertex
    const boundRoot = bindVertex(tree, root.id);
    boundChild.$moveTo(boundRoot);
    expect(boundChild.$parentId).toBe(root.id);

    // Move using string ID
    boundChild.$moveTo(parent1.id);
    expect(boundChild.$parentId).toBe(parent1.id);
  });

  test('structural methods: $delete', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const child = tree.newVertex(root.id);

    const boundChild = bindVertex(tree, child.id);

    // Delete the vertex
    boundChild.$delete();

    // Verify it's deleted (moved to NULL parent, removed from original parent)
    expect(boundChild.$parentId).toBe('0'); // NULL_VERTEX_ID
    expect(root.childrenIds).not.toContain(child.id);
  });

  test('structural methods: $newChild and $newNamedChild', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();

    const Person = z.object({
      name: z.string(),
      age: z.number(),
    });

    const boundRoot = bindVertex(tree, root.id, Person);

    // Create unnamed child
    const child1 = boundRoot.$newChild({ name: 'Child1', age: 10 });
    expect(child1.id).toBeDefined();
    expect(child1.getProperty('_n')).toBe('Child1');
    expect(child1.getProperty('age')).toBe(10);
    expect(boundRoot.$childrenIds).toContain(child1.id);

    // Create named child
    const child2 = boundRoot.$newNamedChild('Child2', { age: 20 });
    expect(child2.id).toBeDefined();
    expect(child2.getProperty('_n')).toBe('Child2');
    expect(child2.getProperty('age')).toBe(20);
    expect(boundRoot.$childrenIds).toContain(child2.id);

    // Verify parent has both children
    expect(boundRoot.$children.length).toBe(2);
  });

  test('structural methods: $observe', async () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = tree.newVertex(root.id);

    const boundVertex = bindVertex(tree, v.id);

    const events: any[] = [];
    const unobserve = boundVertex.$observe((e) => {
      events.push(...e);
    });

    // Make changes
    boundVertex.name = 'Test' as any;
    boundVertex.name = 'Test2' as any;

    // Wait for batched events to process (~33ms)
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should have received events
    expect(events.length).toBeGreaterThan(0);
    const propertyEvents = events.filter(e => e.type === 'property');
    expect(propertyEvents.length).toBeGreaterThan(0);
    expect(propertyEvents.some(e => e.key === '_n')).toBe(true);

    // Cleanup
    unobserve();
  });

  test('structural methods: $observeChildren', async () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const parent = tree.newVertex(root.id);

    const boundParent = bindVertex(tree, parent.id);

    const childrenSnapshots: any[][] = [];
    const unobserve = boundParent.$observeChildren((children) => {
      childrenSnapshots.push(children);
    });

    // Add children
    const child1 = tree.newVertex(parent.id);
    const child2 = tree.newVertex(parent.id);

    // Wait for batched events to process (~33ms)
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should have received children change events
    expect(childrenSnapshots.length).toBeGreaterThan(0);
    const finalSnapshot = childrenSnapshots[childrenSnapshots.length - 1];
    expect(finalSnapshot.some((c: any) => c.id === child1.id)).toBe(true);
    expect(finalSnapshot.some((c: any) => c.id === child2.id)).toBe(true);

    // Cleanup
    unobserve();
  });

  test('sync between Vertex and bound proxy', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();

    // Create a child vertex normally (non-bound)
    const v = root.newChild();

    // Create two bound proxies pointing at the same vertex
    const refA = bindVertex<{ score: number }>(tree, v.id);
    const refB = bindVertex<{ score: number }>(tree, v.id);

    // 1) Write via Vertex API
    v.setProperty('score', 10);

    // Reads via bound proxies should reflect the value
    expect(refA.score).toBe(10);
    expect(refB.score).toBe(10);

    // 2) Write via a bound proxy
    refA.score = 42;

    // Vertex.getProperty should reflect the new value
    expect(v.getProperty('score')).toBe(42);

    // Other bound proxies also see the change
    expect(refB.score).toBe(42);
  });

});