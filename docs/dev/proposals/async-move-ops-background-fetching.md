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

## Windowed state vector + offloaded ops
- Keep only post-barrier ranges in the `StateVector`; track `barrierByPeer: Record<peerId, counter>` indicating a fully-covered prefix `[1..barrier]` that was offloaded.
- Sync envelope includes `{ stateVectorPostBarrier, barrierByPeer }`. Peers must not send pre-barrier ops unless explicitly requested.
- Selective backfill: only when a provisional placement or an incoming op requires context outside the window, request minimal older ranges just enough to cover the causal predecessors; stop as soon as the anchor resolves. Never reload full history by default.
- Eviction advances `barrierByPeer` as the window slides; persistence stores both post-barrier ranges and barriers for fast warm starts.

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
2. Introduce windowed vectors + `barrierByPeer` negotiation in sync envelopes.
3. Integrate `StateVector`-based selective backfill for older ranges.
4. Engine changes: boundary-aware undo/do/redo and re-evaluation on merge.
5. Persistence + tests (flicker, reorder, fetch failure, large trees; barrier advances; selective backfill limits).
