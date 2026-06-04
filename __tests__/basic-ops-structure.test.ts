import { describe, expect, test } from "vitest";
import { RepTree } from "../src";
import { isAnyPropertyOp, isMoveVertexOp } from "../src/operations";

describe("Basic ops structure", () => {
  test("property and move clocks are independent", () => {
    const tree = new RepTree("peer1");
    const root = tree.createRoot();

    // Move op: createRoot() creates a root vertex via a move op
    // Property op: createRoot() also sets _c, which is a property op
    // The important invariant is that move ops and prop ops each have their own counters.
    const ops = tree.getAllOps();

    const moveOps = ops.filter(isMoveVertexOp);
    const propOps = ops.filter(isAnyPropertyOp);

    expect(moveOps.length).toBeGreaterThan(0);
    expect(propOps.length).toBeGreaterThan(0);

    // After createRoot(), each stream should start at counter 1 for this peer.
    expect(moveOps[0].id.peerId).toBe("peer1");
    expect(propOps[0].id.peerId).toBe("peer1");
    expect(moveOps[0].id.counter).toBe(1);
    expect(propOps[0].id.counter).toBe(1);

    // Adding another property should increment only prop clock.
    const lastPropCounterBefore = propOps[propOps.length - 1].id.counter;
    root.setProperty("name", "Project");
    const ops2 = tree.getAllOps();
    const propOps2 = ops2.filter(isAnyPropertyOp);
    const moveOps2 = ops2.filter(isMoveVertexOp);

    expect(moveOps2.length).toBe(moveOps.length);
    expect(propOps2.length).toBe(propOps.length + 1);
    expect(propOps2[propOps2.length - 1].id.counter).toBe(lastPropCounterBefore + 1);
  });
});