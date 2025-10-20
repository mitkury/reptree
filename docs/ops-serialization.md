# Operation Serialization Guidelines

This document outlines practical recommendations for serializing and deserializing RepTree operations ("ops") for transport and storage.

## Scope

- Targets Move and Set-Property ops only
- Assumes JSON as the interchange format
- Focuses on safety, clarity, and forward compatibility

## TL;DR

- Use JSON with a small, explicit wire schema
- Include an op type (`t`) and a schema version (`v`)
- Represent property deletion explicitly; do not rely on JSON `undefined`
- Only send persistent property ops (`transient: false`) over the network
- Validate on ingest: only allow JSON‑serializable property values and plain objects

## Why JSON

- Cross‑language and tooling‑friendly
- Streams and storage systems (HTTP, WebSocket, S3, DB) handle JSON well
- RepTree properties are JSON‑serializable by design

## Recommended Wire Shapes

Use a compact, explicit form with an op type and a version. Example schema (v1):

```json
{
  "t": "move",
  "v": 1,
  "id": { "counter": 42, "peerId": "peerA" },
  "targetId": "vertex-123",
  "parentId": "vertex-001" // or null
}
```

```json
{
  "t": "set",
  "v": 1,
  "id": { "counter": 43, "peerId": "peerA" },
  "targetId": "vertex-123",
  "key": "name",
  "hasValue": true,               // distinguishes null from deletion
  "value": "Project",            // present only when hasValue === true
  "transient": false              // do not send transient ops across peers
}
```

Notes:
- `v` (version) allows safe schema evolution later.
- `hasValue` clearly separates a real `null` from deletion. If `hasValue` is `false`, omit `value` entirely.
- `counter` should be kept within JavaScript’s safe integer range. See Number Safety below.

## Number Safety

- `id.counter` is a JavaScript number in RepTree.
- Keep counters ≤ `Number.MAX_SAFE_INTEGER`.
- If you must exceed that in storage, encode as a string on the wire and convert back with range checks when deserializing.

## Property Values

RepTree supports any JSON‑serializable value for properties:
- Primitives: string, number, boolean, null
- Arrays of JSON values
- Plain objects (no class instances; prototype must be `Object.prototype` or `null`)

Not supported (reject on ingest): `undefined` (use deletion semantics), `Date` objects (use ISO strings), `Map`, `Set`, `RegExp`, `BigInt`, functions, symbols, TypedArrays, class instances.

## Transient Ops

- `transient: true` property ops are local overlays intended for UI drafts.
- Recommendation: do not serialize or transmit transient ops between peers. Filter them out before send.

## Serialization Helpers (Example)

Below is a minimal example showing how to export/import ops to/from the recommended wire shapes.

```ts
import type { VertexOperation, MoveVertex, SetVertexProperty } from 'reptree';
import { isMoveVertexOp } from 'reptree';

// Wire types
type WireOp = WireMoveOp | WireSetOp;

type WireMoveOp = {
  t: 'move';
  v: 1;
  id: { counter: number | string; peerId: string };
  targetId: string;
  parentId: string | null;
};

type WireSetOp = {
  t: 'set';
  v: 1;
  id: { counter: number | string; peerId: string };
  targetId: string;
  key: string;
  hasValue: boolean;
  value?: unknown;   // present only when hasValue === true
  transient: boolean;
};

export function exportOps(ops: ReadonlyArray<VertexOperation>): WireOp[] {
  return ops
    .filter(op => !("transient" in op && (op as any).transient === true))
    .map(op => {
      if (isMoveVertexOp(op)) {
        const m = op as MoveVertex;
        return {
          t: 'move', v: 1,
          id: { counter: m.id.counter, peerId: m.id.peerId },
          targetId: m.targetId,
          parentId: m.parentId,
        } as WireMoveOp;
      } else {
        const s = op as SetVertexProperty;
        const hasValue = s.value !== undefined;
        const base: WireSetOp = {
          t: 'set', v: 1,
          id: { counter: s.id.counter, peerId: s.id.peerId },
          targetId: s.targetId,
          key: s.key,
          hasValue,
          transient: s.transient,
        };
        if (hasValue) (base as any).value = s.value;
        return base;
      }
    });
}

export function importOps(wireOps: WireOp[]): VertexOperation[] {
  return wireOps.map((w): VertexOperation => {
    if (w.t === 'move') {
      return {
        id: { counter: Number((w as WireMoveOp).id.counter), peerId: w.id.peerId },
        targetId: w.targetId,
        parentId: w.parentId,
      } as MoveVertex;
    }
    const s = w as WireSetOp;
    return {
      id: { counter: Number(s.id.counter), peerId: s.id.peerId },
      targetId: s.targetId,
      key: s.key,
      value: s.hasValue ? (s as any).value : undefined,
      transient: !!s.transient,
    } as SetVertexProperty;
  });
}
```

## Deserialization Checklist

When ingesting wire ops:
- Validate shape: required fields present, `t` and `v` recognized
- Ensure `id.counter` is a number within safe range (or safely convertible from string)
- For `set` ops:
  - If `hasValue === false`, treat as deletion (value `undefined`)
  - If `hasValue === true`, assert that `value` is JSON‑serializable and is a plain object/array/primitive/null
- Reject unsupported values and unknown types; log and skip

## Versioning

- Start with `v: 1` and increment for breaking wire changes
- Maintain backward compatible readers when possible
- Reserve `t` and `v` keys for the envelope; keep payload keys stable and documented

## Storage Notes

- Batch multiple ops per object/file to minimize storage overhead
- Prefer newline‑delimited JSON (NDJSON) for append‑only logs
- Consider gzip or zstd for archival; JSON compresses well due to repeated keys

## Summary

- Use an explicit JSON wire schema with `t` and `v`
- Encode deletion explicitly with `hasValue`
- Never transmit transient ops
- Validate strictly on ingest and allow only JSON‑serializable values
