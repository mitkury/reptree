## BindedVertex<T> Type — API Proposal

### TL;DR
- Introduce a `BindedVertex<T>` type for bound vertex objects
- Add `useTransient` method directly on the bound object
- Clear separation from the `Vertex` class (tree node)

---

### Problem
Currently, `bindVertex` returns a plain `T`, which:
- Doesn't distinguish bound objects from regular objects
- Can't have methods like `useTransient` without conflicting with user properties
- Makes it unclear that the object is CRDT-backed

### Proposed API

```typescript
type BindedVertex<T> = T & {
  useTransient(fn: (t: T) => void): void;
};

// Usage
const message = vertex.bind<Message>(); // returns BindedVertex<Message>

message.text = "saved";                 // persistent write

message.useTransient(m => {             // transient writes
  m.text = "preview";
  m.author = "draft";
});

message.text = "final";                 // persistent write (clears transient)
```

### Implementation

1. **Define type in `reactive.ts`:**
   ```typescript
   export type BindedVertex<T> = T & {
     useTransient(fn: (t: T) => void): void;
   };
   ```

2. **Update `bindVertex` signature:**
   ```typescript
   export function bindVertex<T extends Record<string, unknown>>(
     tree: RepTree,
     vertexId: string,
     schemaOrOptions?: SchemaLike<T> | BindOptions<T>
   ): BindedVertex<T>
   ```

3. **Add `useTransient` to proxy:**
   - Implement as a method on the returned proxy
   - Inside, create nested proxy with `writes: 'transient'` option
   - Call provided callback with transient proxy

4. **Update `Vertex.bind()` return type:**
   ```typescript
   bind<T extends Record<string, unknown>>(
     schemaOrOptions?: SchemaLike<T> | BindOptions<T>
   ): BindedVertex<T>
   ```

### Benefits

1. **Type safety**: Clear distinction from `Vertex` class and plain objects
2. **Extensibility**: Easy to add methods like `.commit()`, `.revert()`, `.clone()`
3. **Ergonomics**: Methods live on the object you're working with
4. **No conflicts**: Methods use Symbol keys internally to avoid property collisions

### Future Extensions

```typescript
type BindedVertex<T> = T & {
  useTransient(fn: (t: T) => void): void;
  commit(): void;           // commit all pending transients
  revert(): void;           // clear all transients
  clone(): BindedVertex<T>; // create independent copy
  toJSON(): T;              // serialize without CRDT metadata
};
```

### Naming

- **BindedVertex** (chosen): Past tense of "bind", clear action
- Alternatives: `BoundVertex`, `ReactiveVertex`, `LiveVertex`

### Backward Compatibility

Fully compatible. Existing code without explicit types continues to work:
```typescript
const obj = bindVertex(tree, id); // works, inferred as BindedVertex<Record<...>>
```

---

### Recommendation

Implement `BindedVertex<T>` type with `useTransient` method first. This provides a clean foundation for future method additions while maintaining clear separation from the `Vertex` tree node class.

