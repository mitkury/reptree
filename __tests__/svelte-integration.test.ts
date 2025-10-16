import { describe, test, expect } from 'vitest';
import { RepTree } from '../dist/index.js';
import { z } from 'zod';

describe('Svelte Integration', () => {
  test('BindedVertex works when wrapped in object (simulates $state)', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = root.newChild();

    const Person = z.object({
      name: z.string(),
      age: z.number().int().min(0),
    });

    const person = v.bind(Person);

    // Simulate what Svelte 5's $state() might do - wrap in an object
    const state = { person };

    // Write through the state object
    state.person.name = 'Alice' as any;
    state.person.age = 30 as any;

    // Verify writes went through
    expect(tree.getVertexProperty(v.id, '_n')).toBe('Alice');
    expect(tree.getVertexProperty(v.id, 'age')).toBe(30);

    // Verify reads work
    expect(state.person.name).toBe('Alice');
    expect(state.person.age).toBe(30);
  });

  test('BindedVertex property reads trigger tracking (Proxy trap works)', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = root.newChild();

    const Person = z.object({
      name: z.string(),
      age: z.number(),
    });

    const person = v.bind(Person);

    // Track which properties are accessed (simulates Svelte's tracking)
    const accessedProps = new Set<string>();
    const tracked = new Proxy(person, {
      get(target, prop) {
        if (typeof prop === 'string' && !prop.startsWith('$') && prop !== 'useTransient' && prop !== 'commitTransients') {
          accessedProps.add(prop);
        }
        return (target as any)[prop];
      }
    });

    // "Render" by reading properties
    const _ = tracked.name;
    const __ = tracked.age;

    // Verify tracking happened
    expect(accessedProps.has('name')).toBe(true);
    expect(accessedProps.has('age')).toBe(true);
  });

  test('BindedVertex updates can trigger external callbacks (simulates Svelte re-render)', async () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = root.newChild();

    const Person = z.object({
      name: z.string(),
      age: z.number(),
    });

    const person = v.bind(Person);

    // Track re-renders
    let renderCount = 0;
    const renders: any[] = [];

    // Simulate Svelte's effect system
    const unobserve = person.$observe(() => {
      renderCount++;
      renders.push({ name: person.name, age: person.age });
    });

    // Make changes
    person.name = 'Alice' as any;
    person.age = 30 as any;

    // Wait for batched events (~33ms)
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify observer was called
    expect(renderCount).toBeGreaterThan(0);
    expect(renders[renders.length - 1].name).toBe('Alice');

    unobserve();
  });

  test('Vertex methods work through wrapped state', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const parent = root.newChild();

    const Folder = z.object({
      name: z.string(),
    });

    const folder = parent.bind(Folder);

    // Wrap in state object
    const state = { folder };

    // Use vertex methods through state
    const child = state.folder.$newNamedChild('SubFolder', { name: 'Sub' });
    expect(child.getProperty('_n')).toBe('SubFolder');

    // Verify parent relationship
    expect(state.folder.$children.length).toBe(1);
    expect(state.folder.$children[0].id).toBe(child.id);
  });

  test('Multiple BindedVertex instances can coexist in state', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v1 = root.newChild();
    const v2 = root.newChild();

    const Person = z.object({
      name: z.string(),
      age: z.number(),
    });

    const person1 = v1.bind(Person);
    const person2 = v2.bind(Person);

    // Simulate Svelte state with multiple reactive objects
    const state = {
      people: [person1, person2]
    };

    // Write to both
    state.people[0].name = 'Alice' as any;
    state.people[0].age = 30 as any;
    state.people[1].name = 'Bob' as any;
    state.people[1].age = 25 as any;

    // Verify both work independently
    expect(state.people[0].name).toBe('Alice');
    expect(state.people[0].age).toBe(30);
    expect(state.people[1].name).toBe('Bob');
    expect(state.people[1].age).toBe(25);
  });

  test('BindedVertex maintains reference equality for methods', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = root.newChild();

    const person = v.bind();

    // Methods should maintain reference equality (important for Svelte)
    const moveTo1 = person.$moveTo;
    const moveTo2 = person.$moveTo;
    expect(moveTo1).toBe(moveTo2);

    const observe1 = person.$observe;
    const observe2 = person.$observe;
    expect(observe1).toBe(observe2);
  });

  test('BindedVertex has equals method for Svelte 5 compatibility', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v1 = root.newChild();
    const v2 = root.newChild();

    const Person = z.object({
      name: z.string(),
    });

    const person1 = v1.bind(Person);
    const person2 = v2.bind(Person);

    // equals method should exist
    expect(typeof person1.equals).toBe('function');

    // Same vertex should be equal
    expect(person1.equals(person1)).toBe(true);

    // Different vertices should not be equal
    expect(person1.equals(person2)).toBe(false);

    // Non-vertex should not be equal
    expect(person1.equals({ name: 'test' })).toBe(false);
    expect(person1.equals(null)).toBe(false);
  });

  test('BindedVertex can be used directly as state root (not wrapped in object)', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();
    const v = root.newChild();

    const Person = z.object({
      name: z.string(),
      age: z.number(),
    });

    const person = v.bind(Person);

    // Simulate $state(person) - direct usage, not $state({ person })
    // In this test, we just verify the person object works correctly when used directly
    
    // Write directly to the bound vertex
    person.name = 'Alice';
    person.age = 30;

    // Verify writes went through
    expect(tree.getVertexProperty(v.id, '_n')).toBe('Alice');
    expect(tree.getVertexProperty(v.id, 'age')).toBe(30);

    // Verify reads work
    expect(person.name).toBe('Alice');
    expect(person.age).toBe(30);

    // Verify vertex methods work
    expect(person.$id).toBe(v.id);
    expect(typeof person.$observe).toBe('function');
    expect(typeof person.equals).toBe('function');

    // Create child through the bound vertex
    const child = person.$newNamedChild('Child', { name: 'Bob', age: 5 });
    expect(child.getProperty('_n')).toBe('Child');
    expect(person.$children.length).toBe(1);

    // This pattern should work fine in Svelte:
    // let person = $state(v.bind(Person));
    // <input bind:value={person.name} />
  });
});

