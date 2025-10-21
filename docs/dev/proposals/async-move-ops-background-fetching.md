# Async move ops with background fetching

## Goal / DX
- `v.moveTo(target)` remains non-async; callers proceed immediately.
- RepTree applies the move optimistically; corrects position when older ops arrive.

## Core idea
- Maintain a sliding operation window with an "oldest-known" watermark.
- If undo/do/redo hits the window boundary, apply the move as if it were the oldest, mark it provisional, and trigger background fetch of older ops.

## Data structures
- OperationStore (sliding window) with head/tail watermarks.
- Provisional flags per op/vertex (e.g., position provisional until a counter/watermark).
- Range-based `StateVector` to compute missing older ranges efficiently.

## Algorithm (happy path)
1. Apply the move optimistically; if boundary encountered, place as oldest and tag provisional.
2. Background fetch: compare local `StateVector` to server; request missing older ranges.
3. Merge fetched ops; recompute tree (undo/do/redo as needed).
4. Clear provisional tags; emit minimal change events if the position changes.
5. Stop fetching when ranges fully cover the move’s causal predecessors or no gaps remain.

## API / UX
- No API changes: `moveTo` stays sync.
- Optional observability for UIs: `$pendingOpsCount`, `$isPositionProvisional`, and a `'positionResolved'` event.

## Persistence
- Persist op window + `StateVector` for fast warm starts.
- On load, resume background fetching until watermarks are satisfied.

## Failure modes
- Network errors: keep provisional state with backoff; surface a lightweight health signal.
- Memory pressure: evict oldest fully-acknowledged ops beyond window; never evict below the watermark needed for local pending ops.

## Correctness
- Move-tree CRDT guarantees convergence; speculative placement is corrected deterministically when history is filled.
- LWW properties are unaffected; only structure can be provisional.

## Phased implementation
1. Add OperationStore window + watermarks + provisional tagging.
2. Integrate `StateVector`-based fetcher for older ranges.
3. Engine changes: boundary-aware undo/do/redo and re-evaluation on merge.
4. Persistence + tests (flicker, reorder, fetch failure, large trees).
