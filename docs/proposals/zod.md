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

## Implementation Steps

1. **Add `zod` dependency**  
   ```bash
   npm install zod
   ```
2. **Extend `RepTree`**: add `parseVertex` method as above.
3. **Document**: update README and types with usage examples.
4. **Tests**: add unit tests to ensure schemas catch invalid data and succeed when valid.

## Benefits

- Ensures vertex data meets the expected shape at runtime.
- Reduces ad-hoc validation code in client apps.
- Leverages TypeScript inference for resulting types.

---
*This proposal outlines a lightweight integration of Zod with RepTree to bring runtime validation and type safety to vertex properties.*
