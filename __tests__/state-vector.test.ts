import { describe, expect, test } from 'vitest';
import { StateVector, newSetNodePropertyOp } from '../src';

describe('StateVector', () => {
  test('remove deletes a single-value range and removes the peer entry', () => {
    const vector = new StateVector({ peer1: [[3, 3]] });

    expect(vector.remove('peer1', 3)).toBe(true);

    expect(vector.getState()).toEqual({});
  });

  test('remove shrinks a range from the start or end', () => {
    const vector = new StateVector({ peer1: [[1, 5]] });

    expect(vector.remove('peer1', 1)).toBe(true);
    expect(vector.getState()).toEqual({ peer1: [[2, 5]] });

    expect(vector.remove('peer1', 5)).toBe(true);
    expect(vector.getState()).toEqual({ peer1: [[2, 4]] });
  });

  test('remove splits a range from the middle', () => {
    const vector = new StateVector({ peer1: [[1, 5]] });

    expect(vector.remove('peer1', 3)).toBe(true);

    expect(vector.getState()).toEqual({ peer1: [[1, 2], [4, 5]] });
  });

  test('remove for an absent counter is a no-op', () => {
    const vector = new StateVector({ peer1: [[1, 2], [4, 5]] });

    expect(vector.remove('peer1', 3)).toBe(false);
    expect(vector.remove('peer2', 1)).toBe(false);

    expect(vector.getState()).toEqual({ peer1: [[1, 2], [4, 5]] });
  });

  test('removeFromOp removes the operation id from the vector', () => {
    const op = newSetNodePropertyOp(2, 'peer1', 'node1', 'name', 'Desk');
    const vector = StateVector.fromOperations([
      newSetNodePropertyOp(1, 'peer1', 'node1', 'kind', 'object'),
      op,
      newSetNodePropertyOp(3, 'peer1', 'node1', 'color', 'red'),
    ]);

    expect(vector.removeFromOp(op)).toBe(true);

    expect(vector.getState()).toEqual({ peer1: [[1, 1], [3, 3]] });
  });

  test('getState returns a copy of internal ranges', () => {
    const vector = new StateVector({ peer1: [[1, 2]] });
    const state = vector.getState();

    state.peer1[0][0] = 99;
    state.peer1.push([100, 100]);

    expect(vector.getState()).toEqual({ peer1: [[1, 2]] });
  });
});
