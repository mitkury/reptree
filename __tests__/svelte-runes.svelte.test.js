import { flushSync } from 'svelte';
import { expect, test } from 'vitest';
import { RepTree } from '../dist/index.js';
import { z } from 'zod';

test('BindedVertex works with actual Svelte $state() rune', () => {
	const tree = new RepTree('peer1');
	const root = tree.createRoot();
	const v = root.newChild();

	const Person = z.object({
		name: z.string(),
		age: z.number(),
	});

	// ✅ Use $state() - Svelte won't double-wrap because our Proxy has a custom prototype
	let person = $state(v.bind(Person));

	// Write through $state
	person.name = 'Alice';
	person.age = 30;

	// Verify it persisted to CRDT
	expect(tree.getVertexProperty(v.id, '_n')).toBe('Alice');
	expect(tree.getVertexProperty(v.id, 'age')).toBe(30);

	// Verify we can read back
	expect(person.name).toBe('Alice');
	expect(person.age).toBe(30);

	// Verify vertex methods work
	expect(person.$id).toBe(v.id);
	expect(typeof person.$observe).toBe('function');
	expect(typeof person.equals).toBe('function');
});

test('BindedVertex.equals() works with actual $state()', () => {
	const tree = new RepTree('peer1');
	const root = tree.createRoot();
	const v1 = root.newChild();
	const v2 = root.newChild();

	let person1 = $state(v1.bind());
	let person2 = $state(v2.bind());

	// equals method should work correctly
	expect(person1.equals(person1)).toBe(true);
	expect(person1.equals(person2)).toBe(false);
});

test('Multiple BindedVertex with $state()', () => {
	const tree = new RepTree('peer1');
	const root = tree.createRoot();
	const v1 = root.newChild();
	const v2 = root.newChild();

	const Person = z.object({
		name: z.string(),
		age: z.number(),
	});

	// Array of BindedVertex objects - each wrapped in $state()
	let people = $state([v1.bind(Person), v2.bind(Person)]);

	people[0].name = 'Alice';
	people[0].age = 30;
	people[1].name = 'Bob';
	people[1].age = 25;

	expect(people[0].name).toBe('Alice');
	expect(people[1].name).toBe('Bob');
});

test('Vertex methods work through $state()', () => {
	const tree = new RepTree('peer1');
	const root = tree.createRoot();
	const parent = root.newChild();

	let folder = $state(parent.bind());

	// Use vertex methods
	const child = folder.$newNamedChild('File', { type: 'file' });
	expect(child.getProperty('_n')).toBe('File');

	// Verify parent-child relationship
	expect(folder.$children.length).toBe(1);
	expect(folder.$children[0].id).toBe(child.id);
});

test('$derived works with BindedVertex', () => {
	const tree = new RepTree('peer1');
	const root = tree.createRoot();
	const v = root.newChild();

	const Person = z.object({
		name: z.string().optional(),
		age: z.number(),
	});

	// ✅ Use $state() - creates double-Proxy that tracks reads/writes
	let person = $state(v.bind(Person));

	// Create derived value - will react to person.name changes
	let displayName = $derived(person.name ? `Name: ${person.name}` : 'No name');

	// Initially no name
	expect(displayName).toBe('No name');

	// Set name - Svelte's Proxy tracks this write
	person.name = 'Alice';
	flushSync();

	// Derived value should update immediately
	expect(displayName).toBe('Name: Alice');
});

test('$effect.root works with BindedVertex', async () => {
	const cleanup = $effect.root(() => {
		const tree = new RepTree('peer1');
		const root = tree.createRoot();
		const v = root.newChild();

		const Person = z.object({
			name: z.string().optional(),
			age: z.number(),
		});

		// Use $state() - our Proxy has STATE_SYMBOL
		let person = $state(v.bind(Person));
		let changes = [];

		// Use $effect to observe changes
		$effect(() => {
			const unobserve = person.$observe((events) => {
				changes.push(events);
			});

			return () => unobserve();
		});

		// Make changes
		person.name = 'Alice';
		person.age = 30;

		flushSync();

		// Return a promise to wait for batched observers
		return new Promise((resolve) => {
			setTimeout(() => {
				// Should have received change events
				expect(changes.length).toBeGreaterThan(0);
				resolve();
			}, 50);
		});
	});

	await cleanup();
});
