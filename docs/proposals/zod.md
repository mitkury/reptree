# Proposal: Integrate Zod for Vertex Schema Validation

## Motivation

RepTree vertices store properties in a generic map (`Record<string, unknown>`), but many applications require those properties to conform to a specific interface. Using [Zod](https://github.com/colinhacks/zod) we can validate and infuse runtime type safety, ensuring data integrity and reducing boilerplate in user code.

## High-Level API

```ts
import { RepTree } from 'reptree';
import { ZodSchema, z } from 'zod';

// Generic helper
function parseVertex<T>(
  tree: RepTree,
  vertexId: string,
  schema: ZodSchema<T>
): T {
  const props = tree.getVertexProperties(vertexId);
  return schema.parse(props);
}
```

### Proposed `RepTree` Extension

Add a method `parseVertex<T>(id: string, schema: ZodSchema<T>): T`.

```ts
class RepTree {
  /* ...existing... */
  parseVertex<T>(vertexId: string, schema: ZodSchema<T>): T {
    const props = this.getVertexProperties(vertexId);
    return schema.parse(props);
  }
}
```

## Example Usage

```ts
const tree = new RepTree('peer1');
const nodeId = tree.newVertex(tree.rootVertex.id).id;

// Define Zod schema
const Person = z.object({
  name: z.string(),
  age: z.number().int().nonnegative(),
});

// Set properties
tree.setVertexProperty(nodeId, 'name', 'Alice');
tree.setVertexProperty(nodeId, 'age', 30);

// Parse and validate
const person = tree.parseVertex(nodeId, Person);
// person: { name: string; age: number }
```

## TypeScript Inference

Zod can infer a TypeScript type directly from your schema:

```ts
export const PersonSchema = z.object({
  name: z.string(),
  age: z.number().int().nonnegative(),
});

export type Person = z.infer<typeof PersonSchema>;

const personTyped: Person = tree.parseVertex(nodeId, PersonSchema);
```

This gives you a static `Person` type (`{ name: string; age: number }`) guaranteed by runtime validation.

## Typed Child Creation

Vertices support passing a plain object to `newChild`, which spreads each key as a property. To enforce your Zod schema and ensure values meet `VertexPropertyType`, you can add a helper:

```ts
import { ZodSchema } from 'zod';
import { VertexPropertyType } from '../src/treeTypes';

Vertex.prototype.newTypedChild = function<T extends Record<string, VertexPropertyType>>(
  schema: ZodSchema<T>,
  raw: unknown
): Vertex & { data: T } {
  const props = schema.parse(raw);
  const v = this.newChild(props);
  return Object.assign(v, { data: props });
};

// Usage:
const rawData = { name: 'Alice', age: 30, tags: ['friend'] };
const child = parent.newTypedChild(PersonSchema, rawData);
// child.data: Person
```

## Reactive Vertex Proxy

For bi-directional reactivity, you can wrap a vertex in a JS Proxy so that:
- **Reads** reflect the latest CRDT state.
- **Writes** call `setVertexProperty` automatically.

```ts
function createReactiveVertex<T extends Record<string, unknown>>(tree: RepTree, id: string): T {
  return new Proxy({} as any, {
    get(_, prop: string) {
      return tree.getVertexProperty(id, prop);
    },
    set(_, prop: string, value) {
      tree.setVertexProperty(id, prop, value as any);
      return true;
    }
  });
}

// Usage:
const reactiveNode = createReactiveVertex(tree, nodeId);
console.log(reactiveNode.name);       // live from CRDT
reactiveNode.age = 31;               // updates CRDT
// Listening for CRDT events and triggers (optional) to sync UI
```

This gives you a lightweight reactive view of the vertex. You may optionally integrate with frameworks (Vue, React) by emitting events on CRDT callbacks.

## Implementation Steps

1. **Add `zod` dependency**  
   ```bash
   npm install zod
   ```
2. **Extend `RepTree`**: add `parseVertex` method as above.
3. **Document**: update README and types with usage examples.
4. **Tests**: add unit tests to ensure schemas catch invalid data and succeed when valid.
5. **Remove unchecked helpers**: remove `getAsTypedObject` and `getChildrenAsTypedArray` from `Vertex`. These legacy methods can be dropped without backward compatibility.

## Benefits

- Ensures vertex data meets the expected shape at runtime.
- Reduces ad-hoc validation code in client apps.
- Leverages TypeScript inference for resulting types.

---
*This proposal outlines a lightweight integration of Zod with RepTree to bring runtime validation and type safety to vertex properties.*
