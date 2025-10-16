## Reactive Bindings: Svelte 5 ($state) Compatibility and Framework‑Agnostic Backend

### TL;DR
- Keep the current `bindVertex(tree, id, schemaOrOptions)` API unchanged.
- Phase 1 (quick fix): adjust the existing Proxy binder to enumerate current public keys so Svelte 5 `$state` can instrument it.
- Phase 2 (robust): introduce a pluggable backend for `bindVertex` with a Proxy backend (today) and a plain‑object (descriptor) backend for frameworks that dislike Proxies.

---

### Background
`bindVertex` currently returns a Proxy that forwards reads and writes to CRDT storage (with optional Zod validation and aliasing). Many frameworks are fine with Proxies, but Svelte 5 runes (`$state`) expects enumerable, configurable properties it can instrument. Today our Proxy advertises few/no keys unless a schema is provided, which likely prevents `$state` from wiring up reactivity.

Relevant code (current `ownKeys`):
```387:397:src/reactive.ts
    ownKeys() {
      const keys = new Set<string>();
      for (const k of Object.keys(schema?.shape ?? {})) keys.add(k);
      if (includeInternalKeys) {
        for (const rule of aliases) keys.add(rule.internalKey);
      }
      return Array.from(keys);
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true } as PropertyDescriptor;
    },
```
This only exposes keys from the schema (if any) and optional internal keys. If a user binds without a schema, frameworks that perform a one‑time enumeration (like `$state`) can’t “see” the keys and won’t instrument them.

---

### Goals
- **Compatibility**: Make `bindVertex` work seamlessly with Svelte 5 `$state` without changing its public API.
- **Framework‑agnostic**: Support React, Vue, Solid, Signals, Svelte, etc., by decoupling the reactive wrapper from any one mechanism.
- **Ergonomics**: Preserve the simple property API and aliases (`name` ↔ `_n`, `createdAt` ↔ `_c`).
- **Validation parity**: Keep field/whole‑object validation behavior identical across implementations.

---

### Phase 1 — Proxy‑Compatible Quick Fix
Minimal change to improve `$state` compat while keeping the Proxy.

- **What**: Expand `ownKeys()` to include current public keys from the vertex, not just schema keys.
  - Gather keys via `tree.getVertexProperties(id)`.
  - Convert internal aliases to public keys (e.g., `_n` → `name`, `_c` → `createdAt`).
  - Merge with `Object.keys(schema.shape ?? {})` so typed fields are present even before first write.
  - Respect `includeInternalKeys` as today (optionally add internal keys).
- **Why it helps**: `$state` can enumerate keys and instrument them, even if no schema was provided.
- **Behavior**: No breaking changes; read/write traps remain as is.

Proposed shape for `ownKeys()`:
```ts
// inside Proxy handler
ownKeys() {
  const keys = new Set<string>();

  // 1) live vertex properties → public keys
  for (const { key: internalKey } of tree.getVertexProperties(id)) {
    const alias = internalToPublic.get(internalKey);
    keys.add(alias ? alias.publicKey : internalKey);
  }

  // 2) schema-defined keys
  for (const k of Object.keys(schema?.shape ?? {})) keys.add(k);

  // 3) optionally expose internal keys for advanced use
  if (includeInternalKeys) {
    for (const rule of aliases) keys.add(rule.internalKey);
  }

  return Array.from(keys);
},
```

- **Acceptance criteria**:
  - `Object.keys(bindVertex(tree, id))` returns the current public keys even without a schema.
  - When using `$state(person)`, binding to `person.name` and `person.age` reflects updates both from local sets and CRDT updates.

---

### Phase 2 — Pluggable Backend: Proxy and Plain‑Object (Descriptor)
Introduce an internal backend abstraction for `bindVertex` while keeping the same public API.

- **API (unchanged surface)**:
  - `bindVertex(tree, id, schemaOrOptions)` continues to exist.
  - Options grow to allow an internal selection: `{ mode?: 'auto' | 'proxy' | 'pojo', schema?, aliases?, includeInternalKeys? }`.
  - Default: `mode: 'auto'` which selects a suitable backend (Proxy in Node/tests, POJO in Svelte or when requested).

- **Descriptor (POJO) backend**:
  - Returns a plain object with per‑key getters/setters via `Object.defineProperty`.
  - Keys seeded from:
    - current vertex properties (converted to public keys via alias rules), and
    - `schema.shape` (if provided).
  - Getters read from CRDT; setters validate and persist to CRDT (same logic as Proxy backend).
  - `$id`, `$parentId`, `$parent`, `$children`, `$childrenIds`, `$moveTo`, `$delete`, `$observe`, `$observeChildren`, `$newChild`, `$newNamedChild` are defined as non‑enumerable, configurable properties to avoid polluting enumerations.
  - Subscribes to `tree.observe(id, ...)`. On property change:
    - Ensures the property exists (define descriptor if new), then performs a normal assignment `obj[publicKey] = value` so frameworks with instrumented setters get notified.

- **Proxy backend**: remains the current implementation (with the Phase 1 `ownKeys()` enhancement).

- **Transient writes**:
  - Keep `useTransient(fn)` and `commitTransients()` on both backends. For the POJO backend, `useTransient` can create a lightweight overlay object that writes via `setTransientVertexProperty`, and `commitTransients` promotes overlays as we do today.

- **Why this solves `$state` robustly**:
  - Svelte 5 instruments regular objects well. The POJO backend presents enumerable keys with configurable descriptors, so `$state` can wrap and track reads/writes seamlessly. External CRDT updates reassign values on the same object reference, triggering instrumented setters.

- **Limitations**:
  - Frameworks that only instrument the keys present at wrap time may not react to brand‑new keys added later. Guidance: seed expected keys (via schema or initial props) before wrapping; or re‑wrap when introducing new fields.

---

### Validation and Aliasing (Parity)
Both backends must:
- Apply field‑level validation when `schema.shape[field]?.safeParse` exists.
- Fallback to whole‑object `schema.safeParse` and adopt coerced/transformed values.
- Convert public ↔ internal keys/values via alias rules (`name` ↔ `_n`, `createdAt` ↔ `_c`), including `Date`↔ISO conversion.

---

### Implementation Plan
- **Step 1 (minor change)**: Implement the `ownKeys()` enhancement in the Proxy backend and ship as a patch/minor release.
- **Step 2 (minor)**: Add backend selection and the POJO backend implementation behind `mode` option; default remains Proxy unless `auto` selects POJO in environments that benefit (or keep Proxy default universally and let users opt‑in to POJO).
- **Step 3**: Document Svelte usage in `docs/reactive-vertices.md` with a Svelte 5 snippet using `$state(bindVertex(...))`.

---

### Test Plan
- Unit tests:
  - Proxy `ownKeys()` exposes live public keys without schema; `Reflect.ownKeys`, `Object.keys` include `name` when `_n` is set.
  - Writes via both backends persist to CRDT; CRDT updates reflect on reads.
  - Validation and aliasing parity across backends.
  - `$` methods exist and are non‑enumerable; attempts to set/delete are ignored as today.
- Integration example (manual / doc):
```svelte
<script lang="ts">
  import { RepTree, bindVertex } from 'reptree';
  const tree = new RepTree('peer1');
  const root = tree.createRoot();
  const v = root.newChild();
  const person = bindVertex(tree, v.id /*, { mode: 'pojo' }*/);
  const personState = $state(person);
</script>

<input bind:value={personState.name} />
<input type="number" bind:value={personState.age} />
```

---

### Risks & Mitigations
- **Dynamic keys after wrap**: Some frameworks instrument only existing keys. Mitigate by seeding keys from schema and current CRDT values; document guidance.
- **Behavior drift between backends**: Centralize validation + alias logic; write cross‑backend tests.
- **Performance**: `ownKeys()` now visits current properties—called infrequently in practice. POJO backend uses direct property access and a single observer.

---

### Acceptance Criteria
- Svelte 5 `$state` works with `bindVertex` using default settings for common cases (pre‑existing keys).
- React/Vue/Solid usage unchanged; no breaking API changes.
- All current tests pass; new tests for enumeration and parity added.

---

### Appendix
- Current Proxy creation site for context:
```124:139:src/reactive.ts
  return new Proxy({} as BindedVertex<T>, {
    get(_target, prop: string | symbol) {
      // Handle useTransient method
      if (prop === RESERVED_METHOD_USE_TRANSIENT) {
        return (fn: (t: T) => void) => {
          // Create a transient proxy (not yet implemented - will need writes: 'transient' support)
          const transientProxy = new Proxy({} as T, {
            get(_t, p: string | symbol) {
              if (typeof p !== 'string') return undefined;
              const rule = publicToInternal.get(p);
              if (rule) {
                const raw = tree.getVertexProperty(id, rule.internalKey);
                return rule.toPublic ? rule.toPublic(raw as unknown) : raw;
              }
              return tree.getVertexProperty(id, p);
            },
```

- Proposed POJO backend skeleton (illustrative):
```ts
function bindVertexPojo<T>(tree: RepTree, id: string, opts: BindOptions<T>): BindedVertex<T> {
  const { schema, aliases = defaultAliases, includeInternalKeys = false } = opts;
  const { publicToInternal, internalToPublic } = buildAliasMaps(aliases);
  const obj: any = {};

  const defineKey = (publicKey: string) => {
    if (Object.prototype.hasOwnProperty.call(obj, publicKey)) return;
    Object.defineProperty(obj, publicKey, {
      enumerable: true,
      configurable: true,
      get() {
        const rule = publicToInternal.get(publicKey);
        const internalKey = rule?.internalKey ?? publicKey;
        const raw = tree.getVertexProperty(id, internalKey);
        return rule?.toPublic ? rule.toPublic(raw) : raw;
      },
      set(value) {
        // field-level or whole-object validation (same logic as proxy)
        // ...
        const rule = publicToInternal.get(publicKey);
        const internalKey = rule?.internalKey ?? publicKey;
        const internalValue = rule?.toInternal ? rule.toInternal(value) : value;
        tree.setVertexProperty(id, internalKey, internalValue as any);
      }
    });
  };

  for (const { key } of tree.getVertexProperties(id)) {
    const alias = internalToPublic.get(key);
    defineKey(alias ? alias.publicKey : key);
  }
  for (const k of Object.keys(schema?.shape ?? {})) defineKey(k);

  // define $-properties/methods as non-enumerable
  Object.defineProperties(obj, {
    $id: { enumerable: false, configurable: true, get: () => id },
    // ... other $-fields and methods
  });

  // reflect external updates
  tree.observe(id, (events) => {
    for (const e of events) if (e.type === 'property') {
      const alias = internalToPublic.get(e.key);
      const publicKey = alias ? alias.publicKey : e.key;
      defineKey(publicKey);
      const val = alias?.toPublic ? alias.toPublic(e.value) : e.value;
      obj[publicKey] = val; // trigger framework instrumentation
    }
  });

  return obj as BindedVertex<T>;
}
```
