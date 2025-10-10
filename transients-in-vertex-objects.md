## Transient properties in Vertex objects — API proposal

### TL;DR
- Introduce a simple, ergonomic transient-write API on `Vertex`:

```ts
vertex.transient((t) => {
  t.someProperty = 100; // transient (non‑permanent) change
});

vertex.someProperty = 101; // permanent change
```

- Add transient write support to the reactive helper:

```ts
const draft = bindVertex(tree, v.id, { writes: 'transient' });
draft.name = 'Preview'; // transient write
```

- Keep current read semantics: transient values override persistent ones on reads by default.
- Do NOT persist or include transient ops in snapshots. Transients replicate only via the immediate local op stream, not via historical catch‑up.
- Do not support transient Yjs writes for now; throw or warn.

---

### Background: current RepTree/Vertex behavior
- RepTree supports transient properties already:
  - `RepTree.setTransientVertexProperty(id, key, value)`
  - `Vertex.setTransientProperty(key, value)`
  - In state: `VertexState.transientProperties` overlays persistent properties when reading.
  - Conflict resolution:
    - Persistent write with a newer OpId removes the transient overlay for that key.
    - Transient writes are tracked separately and do not show up in `getAllOps()`.
- Reactive helper (`bindVertex`) currently writes permanently only; reads reflect the current value (including transient overlays) because `getVertexProperty` defaults to `includingTransient = true`.
- Replication:
  - Transient ops are added to `localOps` (so they can be pushed immediately to peers).
  - They are NOT included in `getAllOps()` or `getMissingOps(...)` catch‑up, which is desirable for ephemeral state.

### Goals
- Developer ergonomics: one obvious way to write transients, close to today’s permanent‑write ergonomics.
- Minimal implementation surface area; reuse existing CRDT plumbing.
- Safe defaults (no accidental persistence), clear limitations (no transient Yjs yet).

### Proposed APIs

#### 1) Block‑scoped transient writes on `Vertex`

```ts
vertex.transient((t) => {
  t.someProperty = 100; // transient write
  delete t.temp;        // clears transient value (equivalent to setting undefined)
});
```

- `t` is a lightweight Proxy bound to the same vertex:
  - `set` → `RepTree.setTransientVertexProperty(id, key, value)`
  - `deleteProperty` → `RepTree.setTransientVertexProperty(id, key, undefined)`
  - `get` → `RepTree.getVertexProperty(id, key, /*includingTransient*/ true)`
- Reads inside the callback see the transient overlay.
- Outside the callback, the overlay remains active until cleared by:
  - a newer persistent write to the same key, or
  - an explicit transient clear (see below).

Optional typed form (leverages the same typing ergonomics as `bindVertex`):

```ts
vertex.transient<Person>((t) => {
  t.age = 30;
});
```

Validation variant (Zod‑like):

```ts
vertex.transient({ schema: Person }, (t) => {
  t.name = 'Preview';
});
```

#### 2) Reactive helper option: transient writes

Extend `BindOptions<T>` with a write mode:

```ts
type WriteMode = 'persistent' | 'transient';

export type BindOptions<T> = {
  schema?: SchemaLike<T>;
  aliases?: AliasRule[];
  includeInternalKeys?: boolean;
  writes?: WriteMode; // default: 'persistent'
};
```

Usage:

```ts
const draft = bindVertex(tree, v.id, { schema: Person, writes: 'transient' });
draft.name = 'Alice (draft)'; // transient

const persisted = bindVertex(tree, v.id, Person);
persisted.name = 'Alice'; // persistent
```

This gives UIs a clean way to separate a transient “draft” object from a persistent one.

#### 3) Convenience helpers on `Vertex`

- `setTransientProperties(props: Record<string, VertexPropertyType> | object)`
  - Batch set transient values (mirrors `setProperties`).
- `clearTransientProperty(key: string)`
- `clearAllTransients()`
  - Clears all transient overlays on the vertex.

Note: today we can clear a single key via `setTransientProperty(key, undefined)`. The two clear helpers above are purely ergonomic. `clearAllTransients()` would require retrieving transient keys (see Implementation).

### Semantics
- Reads include transient overlays by default
  - Already true: `getVertexProperty(id, key)` overlays transients.
  - Callers can opt out via `getVertexProperty(id, key, /*includingTransient*/ false)`.
- Conflict resolution
  - Persistent LWW writes with newer OpId remove transient overlays for the same key (implemented today).
  - Transient writes follow LWW among themselves per key.
- Replication
  - Transient ops travel only through the immediate local op channel (`popLocalOps()` → your transport → `merge(...)`).
  - They are not part of snapshots (`getAllOps()`) or catch‑up diffs (`getMissingOps(...)`).
  - This matches the intuition of ephemeral UI state, hover/selection, in‑progress form edits, etc.
- Yjs/CRDT documents
  - Not supported for transients for now. If a transient write attempts a Yjs value, throw or `console.warn` and no‑op (consistent with current code’s warning path).

### API examples

```ts
// 1) Block-scoped API
vertex.transient((t) => {
  t.progress = 0.3;
  t.selection = ['v1', 'v2'];
});

// later, commit
vertex.setProperty('progress', 1); // removes transient overlay

// 2) Reactive pair (draft vs. persisted)
const draft = bindVertex(tree, v.id, { writes: 'transient' });
const persisted = bindVertex(tree, v.id);

draft.title = 'Working…';   // transient
persisted.title = 'Final';   // persistent

// 3) Batch helpers
vertex.setTransientProperties({ isHovered: true, tempScore: 42 });
vertex.clearTransientProperty('isHovered');
vertex.clearAllTransients();
```

### Implementation plan (low risk)
1) Reactive helper write mode
   - Add `writes?: 'persistent' | 'transient'` to `BindOptions<T>`.
   - In `set` and `deleteProperty` traps:
     - When `writes === 'transient'`, call `tree.setTransientVertexProperty` instead of `setVertexProperty`.
     - Preserve existing alias mapping and optional schema validation.

2) `Vertex.transient`
   - Add method:

```ts
transient<T extends Record<string, unknown>>(
  fnOrOptions: ((t: T) => void) | { schema?: SchemaLike<T>; aliases?: AliasRule[] },
  maybeFn?: (t: T) => void,
): void
```

   - Build a lightweight proxy by delegating to `bindVertex(tree, id, { ...options, writes: 'transient' })`.
   - Invoke the provided callback with the proxy.

3) Convenience helpers
   - `setTransientProperties`: loop entries and call `setTransientVertexProperty`.
   - `clearTransientProperty`: `setTransientVertexProperty(key, undefined)`.
   - `clearAllTransients`: add a `TreeState.getTransientPropertyKeys(vertexId)` (or expose a filtered view) and loop over keys to clear.

4) Event metadata (optional, small)
   - Extend `VertexPropertyChangeEvent` with a `transient: boolean` flag.
   - Mark events emitted from `TreeState.setTransientProperty` accordingly.
   - This lets subscribers distinguish ephemeral vs. persistent changes.

5) Yjs handling
   - In transient write paths, if value is a `Y.Doc`, throw or warn and no‑op.
   - Keep current warning for transient non‑LWW properties.

### Alternatives considered
- `vertex.transients.someProperty = 100` (a persistent proxy property)
  - Pros: terse for ad‑hoc writes.
  - Cons: property name may be confused with data, unclear lifecycle; block‑scoped API communicates intent better.
- `vertex.setProperty(key, value, { transient: true })`
  - Avoids method explosion but complicates typing and readability; we already expose `setTransientProperty` for low‑level use.
- `bindTransientVertex(...)` helper
  - Could be a small alias around `bindVertex(..., { writes: 'transient' })`. Optional sugar.
- Process‑wide `tree.withTransientWrites(fn)`
  - Overly broad; easy to misuse and hard to reason about in concurrent UI flows.

### Developer impact
- Very small learning surface:
  - Use `vertex.transient(fn)` for one‑off blocks.
  - Use `bindVertex(..., { writes: 'transient' })` for UI reactive drafts.
  - Commit by performing a persistent write; the system clears the transient overlay for that key.
- Backward compatible; no breaking changes.

### Open questions / future work
- Should we expose TTL/expiration for transient keys? (e.g., auto‑clear after N ms)
- Do we want a built‑in “promote transient → persistent” helper for a set of keys?
- Should `getMissingOps(...)` optionally include transients behind a flag for specific use cases? Default stays excluded.

---

### Recommendation
Implement `vertex.transient(fn)` and `bindVertex(..., { writes: 'transient' })` first. Add the convenience clear helpers and event metadata as follow‑ups. This provides an ergonomic, low‑risk developer experience on top of the existing transient CRDT machinery, while keeping replication and storage semantics clear and predictable.
