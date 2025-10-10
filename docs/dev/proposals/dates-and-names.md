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
Keep enrichers focused and minimal. We do not need an enricher for names.

- Names: `newNamedVertex` writes `name` directly. No name enricher.
- Dates: Provide one optional enricher `withCreatedAt()` to set `createdAt` on create if missing.

### Shape
```ts
export type VertexEnricher = (ctx: {
  tree: RepTree;
  vertexId: string;
  event: 'create';
}) => void;

class RepTree {
  addEnricher(fn: VertexEnricher): () => void; // returns unregister
}
```

- Execution point: after vertex creation (`create`).
- Ordering: registration order.
- Built-in: `withCreatedAt()` – sets `createdAt` if absent (store ISO for ops; expose Date via helpers if desired).

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

## Migration
No backwards compatibility or migration layer. We will change logic directly:

- `newNamedVertex` now writes `name` (no `_n`).
- Stop auto-writing `_c`.
- Introduce optional `withCreatedAt()` enricher for teams that want creation dates.
- Update lookups/printing/sorting to use `name` and `createdAt`.

## Trade-offs
- Pros: simpler mental model, fewer special cases, public API matches stored keys
- Cons: needs a careful migration to avoid breaking existing data/tests; adds a small enrichment mechanism

## Open Questions
- Should we always store `createdAt` as ISO internally, or allow Date in state and convert only for ops? Recommendation: store ISO in ops; state can hold Date for convenience if desired, but consistency is simpler if state also stores ISO.
- Should `bindVertex` coerce `createdAt` to Date on read by default? Recommendation: yes, when the key is exactly `createdAt`, as a small convenience; or leave it to an optional alias rule for strictness.

## Minimal Implementation Steps
- Implement `addEnricher` (post-create only) in `RepTree`.
- Add `withCreatedAt` helper and use it in README examples.
- Switch `newNamedVertex` to write `name`; update `Vertex.name`, `getVertexByPath`, printing, sorting to use `name`.
- Remove default alias rules in `bindVertex`; keep optional alias support only when explicitly provided.
