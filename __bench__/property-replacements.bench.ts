import { bench, describe } from 'vitest';
import { RepTree } from '../src/RepTree';
import { newMoveNodeOp, newSetNodePropertyOp, type NodeOperation } from '../src/operations';

const PEER_ID = 'replacement-heavy-import';
const STABLE_PROPERTY_COUNT = 1000;
const REPLACEMENT_COUNT = 5000;

const REPLACEMENT_HEAVY_OPS = createReplacementHeavyOps();

describe('RepTree replacement-heavy property load', () => {
  bench('constructor replay - 1000 stable props / 5000 replacements', () => {
    const tree = new RepTree('bench-constructor', REPLACEMENT_HEAVY_OPS);
    if (!tree.root) throw new Error('Expected root after constructor replay');
  });

  bench('merge replay - 1000 stable props / 5000 replacements', () => {
    const tree = new RepTree('bench-merge', []);
    tree.popLocalOps();
    tree.merge(REPLACEMENT_HEAVY_OPS);
    if (!tree.root) throw new Error('Expected root after merge replay');
  });

  bench('merge workaround - vectors disabled then rebuilt', () => {
    const tree = new RepTree('bench-workaround', []);
    tree.popLocalOps();
    tree.stateVectorEnabled = false;
    tree.merge(REPLACEMENT_HEAVY_OPS);
    tree.stateVectorEnabled = true;
    if (!tree.root) throw new Error('Expected root after workaround replay');
  });
});

function createReplacementHeavyOps(): NodeOperation[] {
  const ops: NodeOperation[] = [];
  let propCounter = 1;

  ops.push(newMoveNodeOp(1, PEER_ID, 'root', null));

  for (let i = 0; i < STABLE_PROPERTY_COUNT; i++) {
    ops.push(newSetNodePropertyOp(propCounter++, PEER_ID, 'root', `stable-${i}`, i));
  }

  for (let i = 0; i < REPLACEMENT_COUNT; i++) {
    ops.push(newSetNodePropertyOp(propCounter++, PEER_ID, 'root', 'hot', `value-${i}`));
  }

  return ops;
}
