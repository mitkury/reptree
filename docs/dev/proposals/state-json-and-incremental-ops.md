## State JSON + Incremental Ops Load (S3 state, DynamoDB ops)

A brief plan to warm‑start trees from a compact state JSON in S3 and then load only the latest N ops from a simple cloud DB (e.g., DynamoDB), while remaining compatible with background fetching of older ops.

Related: see `async-move-ops-background-fetching.md` for the windowed history and provisional placement model.

### Goals
- Fast load without replaying full history
- Store state in S3; keep ops in DynamoDB (or similar)
- Apply only the latest N ops eagerly; backfill older gaps lazily
- Preserve compatibility with windowed state vectors and counter barriers

### State JSON (wire shape)

Use a single compact JSON document named “state” (not “snapshot”).

```json
{
  "t": "state",
  "v": 1,
  "treeId": "project-123",
  "stateAt": "2025-10-27T12:34:56.000Z",
  "rootId": "root",
  "stateVector": {
    "peerA": [[1, 120]],
    "peerB": [[3, 40], [45, 60]]
  },
  "counterBarrier": {
    "peerA": 80,
    "peerB": 40
  },
  "vertices": {
    "root": {
      "parentId": null,
      "props": { "name": "Project", "_c": "2025-10-27T12:00:00.000Z" },
      "childrenIds": ["docs", "images"]
    },
    "docs": { "parentId": "root", "props": { "name": "Docs" }, "childrenIds": ["readme"] },
    "readme": { "parentId": "docs", "props": { "name": "README.md", "size": 2048 } },
    "images": { "parentId": "root", "props": { "name": "Images" } }
  }
}
```

Notes:
- `stateVector` uses range format per `docs/vector-states.md`.
- `counterBarrier` is optional and supports the windowed/backfill protocol described in `async-move-ops-background-fetching.md`.
- `childrenIds` are optional; loader can rebuild from `parentId` if absent.

### Storage model

- State (S3):
  - Bucket/key layout: `s3://<bucket>/reptree/state/<treeId>/current.json` (latest)
  - Versioned archives: `s3://<bucket>/reptree/state/<treeId>/state-<ulid>.json`
  - Recommended: S3 object lock or versioning; SSE encryption enabled

- Ops (DynamoDB):
  - Table `reptree_ops`
    - PK: `treeId` (string)
    - SK: `ingestedAt` (ULID/ISO desc‑sortable) — enables “latest N” query
    - Attributes: `peerId` (string), `counter` (number), `opJson` (wire op), `opType` (string), optional `opId`=`peerId#counter`
  - GSI1 (optional for targeted backfill):
    - PK: `treeId#peerId`, SK: `counter` (number) — fetch specific counter ranges

### Load flow

1) Load state from S3
- GET `state/<treeId>/current.json`
- Initialize `RepTree` from `vertices`, `parentId`, `props`
- Install `stateVector` and optional `counterBarrier`

2) Apply latest N ops
- Query DynamoDB: `treeId`, ScanIndexForward=false, `Limit=N`
- Reverse to chronological order and apply
- Skip ops whose `id` is already covered by `stateVector`; update vector as you apply

3) Background backfill (on demand)
- If a move requires pre‑barrier context, mark placement provisional and fetch missing older ranges
- With GSI1: fetch by `treeId#peerId` and `counter` ranges; otherwise page older ops by `ingestedAt`
- Merge, recompute placements, clear provisional flags when resolved

### Save (state) flow

- Trigger: time‑based or after K new ops
- Serialize current tree into State JSON (include `stateVector`; set/advance `counterBarrier` if window/pruning advanced)
- PUT to S3 `current.json` and also append a versioned `state-<ulid>.json`

### Interop with async background fetching

- `counterBarrier` aligns with the proposal’s windowed vector; loaders treat placements that need pre‑barrier history as provisional
- Backfill uses `StateVector.diff` semantics to fetch only missing ranges
- No API changes to `moveTo`; DX remains synchronous

### Minimal helpers (sketch)

```ts
loadStateFromS3(treeId, nRecentOps);
exportStateToS3(treeId);
applyRecentOpsSkippingKnown(ops, stateVector);
listMissingRanges(localVector, remoteVector);
```

### Validation and safety
- Keep `v: 1` for the state wire format; evolve backward‑compatibly
- Ensure property values are JSON‑serializable (see `docs/ops-serialization.md` rules)
- Keep counters within JS safe integer range on ingest
