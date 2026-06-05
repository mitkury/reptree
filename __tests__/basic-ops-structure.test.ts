import { describe, expect, test } from "vitest";
import { RepTree } from "../src";
import { isAnyPropertyOp, isMoveNodeOp } from "../src/operations";

describe("Basic ops structure", () => {
  test("property and move clocks are independent", () => {
    const tree = new RepTree("peer1");
    const root = tree.createRoot();

    // Move op: createRoot() creates a root node via a move op
    // Property op: createRoot() also sets _c, which is a property op
    // The important invariant is that move ops and prop ops each have their own counters.
    const ops = tree.getAllOps();

    const moveOps = ops.filter(isMoveNodeOp);
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
    const moveOps2 = ops2.filter(isMoveNodeOp);

    expect(moveOps2.length).toBe(moveOps.length);
    expect(propOps2.length).toBe(propOps.length + 1);
    expect(propOps2[propOps2.length - 1].id.counter).toBe(lastPropCounterBefore + 1);
  });

  test("getNodeByPath returns the root for empty and slash paths", () => {
    const tree = new RepTree("peer1");
    const root = tree.createRoot();
    const docs = root.newNamedChild("Docs");
    const readme = docs.newNamedChild("README.md");

    expect(tree.getNodeByPath("")?.id).toBe(root.id);
    expect(tree.getNodeByPath("/")?.id).toBe(root.id);
    expect(tree.getNodeByPath("/Docs/README.md/")?.id).toBe(readme.id);
    expect(tree.getNodeByPath("/Missing")).toBeUndefined();
  });

  test("getNodeByPath works after merging ops before reading root", () => {
    const source = new RepTree("peer1");
    const root = source.createRoot();
    const docs = root.newNamedChild("Docs");

    const target = new RepTree("peer2");
    target.merge(source.getAllOps());

    expect(target.getNodeByPath("/Docs")?.id).toBe(docs.id);
  });

  test("wouldMoveCreateCycle explains invalid move checks", () => {
    const tree = new RepTree("peer1");
    const root = tree.createRoot();
    const docs = root.newNamedChild("Docs");
    const readme = docs.newNamedChild("README.md");

    expect(tree.wouldMoveCreateCycle({ targetId: docs.id, parentId: docs.id })).toBe(true);
    expect(tree.wouldMoveCreateCycle({ targetId: docs.id, parentId: readme.id })).toBe(true);
    expect(tree.wouldMoveCreateCycle({ targetId: readme.id, parentId: root.id })).toBe(false);
    expect(tree.wouldMoveCreateCycle({ targetId: docs.id, parentId: null })).toBe(false);
  });

  test("isAncestor keeps its existing argument order for compatibility", () => {
    const tree = new RepTree("peer1");
    const root = tree.createRoot();
    const docs = root.newNamedChild("Docs");
    const readme = docs.newNamedChild("README.md");

    expect(tree.isAncestor(readme.id, docs.id)).toBe(true);
    expect(tree.isAncestor(docs.id, readme.id)).toBe(false);
  });
});
