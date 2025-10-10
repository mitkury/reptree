# Simplifying Dates and Names in RepTree

## Goal
Reduce complexity by removing implicit internal aliases (`_n`, `_c`) from the public surface and replacing them with simple, explicit behaviors:
- Use `name` for named vertices (no `_n` aliasing by default)
- Use enrichment functions to attach common metadata like `createdAt` directly as public fields (no `_c` aliasing)

## Current State (summary)
- Internal properties `_n` and `_c` are used pervasively:
  - `Vertex.name` getter/setter maps to `_n`
  - `RepTree.newNamedVertex()` writes `_n`
  - `RepTree` sets `_c` automatically on creation
  - Sorting and printing rely on `_n` and/or `_c` in `TreeState`
  - Reactive binding (`bindVertex`) exposes aliases by default: `name ↔ _n`, `createdAt ↔ _c` (with Date⇄ISO conversion)
  - Creation helpers normalize props: map `name→_n`, `createdAt→_c`

This works but adds mental overhead: users see `name`/`createdAt`, but the underlying keys are `_n`/`_c`. It also leaks into tests/docs and increases coupling in traversal/sorting.

## Proposed Direction
Keep the internal model simple and make the public API match it directly.

- Names
  - When a vertex is created via a "named" creator, store the name as `name` (string). No default aliasing.
  - `Vertex.name` reads/writes `name` directly.
  - Path lookups and printing use `name` if present.

- Creation time
  - Stop auto-writing `_c`. Instead, support opt‑in enrichment functions.
  - Provide a default enrichment that sets `createdAt: new Date()` when vertices are created.
  - Store `createdAt` as a Date object (public API) or an ISO string (internal), but do it through the enrichment’s explicit logic so it’s transparent. Prefer exposing `createdAt` as a Date to consumers.

- Reactive binding
  - Remove default alias rules. By default, `bindVertex` should pass keys through untouched.
  - If needed, users can supply aliases explicitly (remain supported via options), but the default should reflect actual keys (`name`, `createdAt`).

- Normalization on creation
  - Stop mapping keys. `newChild(props)` and `newNamedChild(name, props)` write props as-is (except filtering unsupported types and ignoring `props.name` when an explicit `name` arg is provided).

## Enrichment Functions
A tree can register one or more enrichers that run on vertex creation (and optionally on rename or other events). Examples:

- addCreatedAt(): sets `createdAt` if missing
- addDefaultName(): ensures `name` is present if using named creation
- custom domain enrichers (e.g., set `type`, compute slugs)

### Shape
```ts
export type VertexEnricher = (ctx: {
  tree: RepTree;
  vertexId: string;
  event: 'create' | 'namedCreate' | 'rename';
}) => void;

class RepTree {
  addEnricher(fn: VertexEnricher): () => void; // returns unregister
}
```

- Execution points:
  - After `newVertexInternal` (create)
  - After `newNamedVertex` (namedCreate)
  - After renaming helper (if provided later) (rename)
- Ordering: enrichers run in registration order.
- Enrichers should be side-effect free beyond setting properties on the target vertex; they should avoid long-running work.

### Built-in enrichers
- `withCreatedAt()` – sets `createdAt` if absent
  - Implementation detail: store as ISO internally for CRDT ops, expose as Date in convenience getters/binding if desired.
- Optional: `withNameFromArg()` – for `newNamedChild`, ensure `name` is set to the provided name if missing in props.

## API Sketch

- RepTree
  - `addEnricher(fn: VertexEnricher): () => void`
  - Stop implicit `_c` write in `newVertex*`
  - `newNamedVertex` writes `name` instead of `_n`

- Vertex
  - `name` getter/setter uses `name`
  - `createdAt` getter reads `createdAt` and returns `Date | undefined`
  - Creation helpers stop mapping keys; continue filtering unsupported types

- TreeState/printing/sorting
  - Replace lookups of `_n`/`_c` with `name`/`createdAt`
  - Sorting by `createdAt` if both present; stable order otherwise

- Reactive binding
  - Default: no alias rules; reads/writes pass through
  - Optionally accept aliases for advanced cases, but default config should not add `name`/`createdAt` rules

## Migration Plan
1. Introduce enrichment API (no breaking changes yet). Keep existing `_n`/`_c` behavior.
2. Add built-in `withCreatedAt` and switch defaults in docs/examples to use it.
3. Switch `newNamedVertex` to write `name` in parallel to `_n` (temp dual-write) while updating consumers (`getVertexByPath`, printing, sorting) to prefer `name` if present.
4. Update `Vertex.name` and binding defaults to prefer `name`/`createdAt` and remove default aliasing rules.
5. Remove `_n`/`_c` usage in codebase; keep a compatibility layer for reading them if encountered in older ops.

## Trade-offs
- Pros: simpler mental model, fewer special cases, public API matches stored keys
- Cons: needs a careful migration to avoid breaking existing data/tests; adds a small enrichment mechanism

## Open Questions
- Should we always store `createdAt` as ISO internally, or allow Date in state and convert only for ops? Recommendation: store ISO in ops; state can hold Date for convenience if desired, but consistency is simpler if state also stores ISO.
- Should `bindVertex` coerce `createdAt` to Date on read by default? Recommendation: yes, when the key is exactly `createdAt`, as a small convenience; or leave it to an optional alias rule for strictness.

## Minimal Implementation Steps
- Implement `addEnricher` and run points in `RepTree`.
- Create `withCreatedAt` helper and use in README examples.
- Switch `newNamedVertex` to `name`, update `Vertex.name`, `getVertexByPath`, printing, and sorting to prefer `name`.
- Remove default alias rules; keep optional alias support in `bindVertex`.
- Provide a compatibility reader that maps `_n`→`name`, `_c`→`createdAt` when seen, during a deprecation window.
