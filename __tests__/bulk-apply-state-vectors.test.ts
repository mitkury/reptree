import { describe, expect, test, vi } from 'vitest';
import {
  RepTree,
  StateVector,
  isAnyPropertyOp,
  isMoveNodeOp,
  newMoveNodeOp,
  newSetNodePropertyOp,
  type NodeOperation,
} from '../src';

describe('bulk apply state vectors', () => {
  function createPropertyHeavyOps(): ReadonlyArray<NodeOperation> {
    const source = new RepTree('peer1');
    const root = source.createRoot();

    for (let nodeIndex = 0; nodeIndex < 25; nodeIndex++) {
      const child = root.newChild();
      child.setProperty('name', `node-${nodeIndex}`);
      child.setProperty('kind', 'item');
      child.setProperty('bounds', {
        x: nodeIndex,
        y: nodeIndex * 2,
        width: 100,
        height: 50,
      });
    }

    return source.getAllOps();
  }

  test('constructor replay does not rebuild the property state vector for new property keys', () => {
    const ops = createPropertyHeavyOps();
    const source = new RepTree('peer1-copy', ops);
    const expectedStateVectors = source.getStateVectors();
    const rebuildSpy = vi.spyOn(StateVector, 'fromOperations');

    try {
      const replayed = new RepTree('peer2', ops);

      expect(rebuildSpy).toHaveBeenCalledTimes(0);
      expect(replayed.compareStructure(source)).toBe(true);
      expect(replayed.getStateVectors()).toEqual(expectedStateVectors);
    } finally {
      rebuildSpy.mockRestore();
    }
  });

  test('constructor replay mutates the property state vector when a compacted property op is replaced', () => {
    const ops: NodeOperation[] = [
      newMoveNodeOp(1, 'remote-move', 'root', null),
      newSetNodePropertyOp(1, 'remote-prop', 'root', 'name', 'first'),
      newSetNodePropertyOp(2, 'remote-prop', 'root', 'name', 'second'),
    ];
    const expected = new RepTree('expected', ops);
    const expectedStateVectors = expected.getStateVectors();
    const rebuildSpy = vi.spyOn(StateVector, 'fromOperations');

    try {
      const replayed = new RepTree('peer2', ops);

      expect(rebuildSpy).toHaveBeenCalledTimes(0);
      expect(replayed.compareStructure(expected)).toBe(true);
      expect(replayed.getStateVectors()).toEqual(expectedStateVectors);
      expect(replayed.getStateVectors()?.prop['remote-prop']).toEqual([[2, 2]]);
    } finally {
      rebuildSpy.mockRestore();
    }
  });

  test('replacement property state vectors send the retained op through getMissingOps', () => {
    const rootMove = newMoveNodeOp(1, 'remote-move', 'root', null);
    const firstName = newSetNodePropertyOp(1, 'remote-prop', 'root', 'name', 'first');
    const secondName = newSetNodePropertyOp(2, 'remote-prop', 'root', 'name', 'second');
    const source = new RepTree('source', [rootMove, firstName, secondName]);
    const receiver = new RepTree('receiver', [rootMove, firstName]);
    const receiverStateVectors = receiver.getStateVectors();

    expect(source.getStateVectors()?.prop['remote-prop']).toEqual([[2, 2]]);
    expect(receiverStateVectors?.prop['remote-prop']).toEqual([[1, 1]]);

    const missingOps = source.getMissingOps(receiverStateVectors!);

    expect(missingOps).toEqual([secondName]);
  });

  test('property state vector matches retained sendable property ops after replacements and losing ops', () => {
    const rootMove = newMoveNodeOp(1, 'remote-move', 'root', null);
    const firstName = newSetNodePropertyOp(1, 'remote-prop', 'root', 'name', 'first');
    const secondName = newSetNodePropertyOp(2, 'remote-prop', 'root', 'name', 'second');
    const losingOlderName = newSetNodePropertyOp(1, 'older-remote-prop', 'root', 'name', 'older');
    const tree = new RepTree('source', [rootMove, firstName, secondName, losingOlderName]);
    const retainedPropertyOps = tree.getAllOps().filter(isAnyPropertyOp);
    const emptyPeer = new RepTree('empty-peer');
    const missingOps = tree.getMissingOps(emptyPeer.getStateVectors()!);

    expect(tree.getStateVectors()?.prop).toEqual(StateVector.fromOperations(retainedPropertyOps).getState());
    expect(retainedPropertyOps).toEqual([secondName]);
    expect(missingOps).toContainEqual(secondName);
    expect(missingOps).not.toContainEqual(firstName);
    expect(missingOps).not.toContainEqual(losingOlderName);
  });

  test('compressed property state vectors do not request evicted property history', () => {
    const rootMove = newMoveNodeOp(1, 'remote-move', 'root', null);
    const firstName = newSetNodePropertyOp(1, 'remote-prop', 'root', 'name', 'first');
    const kind = newSetNodePropertyOp(2, 'remote-prop', 'root', 'kind', 'folder');
    const secondName = newSetNodePropertyOp(3, 'remote-prop', 'root', 'name', 'second');
    const sender = new RepTree('sender', [rootMove, firstName, kind, secondName]);

    const compressedReceiverStateVectors = {
      move: { 'remote-move': [[1, 1]] },
      prop: { 'remote-prop': [[2, 3]] },
    };

    expect(sender.getStateVectors()?.prop['remote-prop']).toEqual([[2, 3]]);
    expect(sender.getMissingOps(compressedReceiverStateVectors)).toEqual([]);
  });

  test('property-heavy merge produces the same state vectors as one-by-one merge', () => {
    const ops = createPropertyHeavyOps();
    const bulk = new RepTree('peer2');
    const oneByOne = new RepTree('peer2');

    bulk.merge(ops);
    for (const op of ops) {
      oneByOne.merge([op]);
    }

    expect(bulk.compareStructure(oneByOne)).toBe(true);
    expect(bulk.getStateVectors()).toEqual(oneByOne.getStateVectors());
  });

  test('property-heavy merge keeps state vectors observable inside callbacks', () => {
    const ops = createPropertyHeavyOps();
    const target = new RepTree('peer2');
    const callbackStateVectors: Array<ReturnType<RepTree['getStateVectors']>> = [];

    target.observeOpApplied((op) => {
      const stateVectors = target.getStateVectors();
      callbackStateVectors.push(stateVectors);

      expect(stateVectors).not.toBeNull();
      if (isMoveNodeOp(op)) {
        expect(new StateVector(stateVectors!.move).contains(op.id)).toBe(true);
      } else if (isAnyPropertyOp(op) && !op.transient) {
        expect(new StateVector(stateVectors!.prop).contains(op.id)).toBe(true);
      }
    });

    target.merge(ops);

    expect(callbackStateVectors.length).toBeGreaterThan(0);
  });

  test('pending moves are not advertised until they are sendable', () => {
    const root = newMoveNodeOp(1, 'remote-move', 'root', null);
    const childWithMissingParent = newMoveNodeOp(2, 'remote-move', 'child-with-missing-parent', 'missing-parent');
    const missingParent = newMoveNodeOp(3, 'remote-move', 'missing-parent', 'root');
    const ops: NodeOperation[] = [
      root,
      childWithMissingParent,
      newSetNodePropertyOp(1, 'remote-prop', 'root', 'name', 'Root'),
      newSetNodePropertyOp(2, 'remote-prop', 'root', 'kind', 'folder'),
    ];
    const target = new RepTree('peer2');
    const emptyPeer = new RepTree('empty-peer');
    const emptyPeerStateVectors = emptyPeer.getStateVectors();

    target.merge(ops);

    expect(target.getStateVectors()?.move['remote-move']).toEqual([[1, 1]]);
    const missingBeforeParent = target.getMissingOps(emptyPeerStateVectors!);
    expect(missingBeforeParent).toContainEqual(root);
    expect(missingBeforeParent).not.toContainEqual(childWithMissingParent);
    expect(missingBeforeParent).toContainEqual(newSetNodePropertyOp(1, 'remote-prop', 'root', 'name', 'Root'));
    expect(missingBeforeParent).toContainEqual(newSetNodePropertyOp(2, 'remote-prop', 'root', 'kind', 'folder'));

    target.merge([missingParent]);

    expect(target.getStateVectors()?.move['remote-move']).toEqual([[1, 3]]);
    const missingAfterParent = target.getMissingOps(emptyPeerStateVectors!);
    expect(missingAfterParent).toContainEqual(root);
    expect(missingAfterParent).toContainEqual(childWithMissingParent);
    expect(missingAfterParent).toContainEqual(missingParent);
    expect(missingAfterParent).toContainEqual(newSetNodePropertyOp(1, 'remote-prop', 'root', 'name', 'Root'));
    expect(missingAfterParent).toContainEqual(newSetNodePropertyOp(2, 'remote-prop', 'root', 'kind', 'folder'));
  });
});
