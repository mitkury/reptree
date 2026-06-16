import { bench, describe } from 'vitest';
import { RepTree } from '../src/RepTree';
import { newMoveNodeOp, newSetNodePropertyOp, type NodeOperation } from '../src/operations';
import type { NodePropertyType } from '../src/treeTypes';

const IMPORT_PEER_ID = 'object-graph-import';
const OBJECT_COUNT = 120;
const FULL_OBJECT_COUNT = 115;
const EXPECTED_NODE_COUNT = 601;
const EXPECTED_OP_COUNT = 6720;

type Props = Record<string, NodePropertyType>;

const OBJECT_GRAPH_OPS = createObjectGraphOps();

describe('RepTree object graph space load', () => {
  bench('constructor replay - 601 nodes / 6720 ops', () => {
    const tree = new RepTree('bench-constructor', OBJECT_GRAPH_OPS);
    if (!tree.root) throw new Error('Expected root after constructor replay');
  });

  bench('merge replay - 601 nodes / 6720 ops', () => {
    const tree = new RepTree('bench-merge', []);
    tree.popLocalOps();
    tree.merge(OBJECT_GRAPH_OPS);
    if (!tree.root) throw new Error('Expected root after merge replay');
  });

  bench('merge workaround - vectors disabled then rebuilt', () => {
    const tree = new RepTree('bench-workaround', []);
    tree.popLocalOps();
    tree.stateVectorEnabled = false;
    tree.merge(OBJECT_GRAPH_OPS);
    tree.stateVectorEnabled = true;
    if (!tree.root) throw new Error('Expected root after workaround replay');
  });
});

function createObjectGraphOps(): NodeOperation[] {
  const ops: NodeOperation[] = [];
  let moveCounter = 1;
  let propCounter = 1;

  const move = (targetId: string, parentId: string | null) => {
    ops.push(newMoveNodeOp(moveCounter++, IMPORT_PEER_ID, targetId, parentId));
  };

  const set = (targetId: string, key: string, value: NodePropertyType) => {
    ops.push(newSetNodePropertyOp(propCounter++, IMPORT_PEER_ID, targetId, key, value));
  };

  const setProps = (targetId: string, props: Props) => {
    for (const [key, value] of Object.entries(props)) {
      set(targetId, key, value);
    }
  };

  const rootId = 'object-graph-root';
  move(rootId, null);
  setProps(rootId, {
    _c: '2026-06-05T21:43:44.179Z',
    type: 'space',
    name: 'Imported object graph',
    sourceFormat: 'batch-import',
  });

  for (let index = 0; index < OBJECT_COUNT; index++) {
    const objectId = `object-${index}`;
    const objectType = index % 4 === 0 ? 'wall' : 'object';
    const objectName = objectType === 'wall' ? `Wall ${index + 1}` : `Object ${index + 1}`;
    const isFullObject = index < FULL_OBJECT_COUNT;

    move(objectId, rootId);
    setProps(objectId, {
      _c: timestampFor(index),
      type: objectType,
      name: objectName,
      tag: objectType,
      order: orderFor(index),
      sourceObjectId: `generated-${objectType}-${index}`,
    });
    set(objectId, 'name', objectName);

    const transformId = `${objectId}-transform`;
    move(transformId, objectId);
    setProps(transformId, {
      type: 'component',
      component: 'transform',
      x: round(-12 + index * 0.37),
      y: objectType === 'wall' ? 1.2 : 0.55,
      z: round(-8 + index * 0.29),
      rotationX: 0,
      rotationY: (index * 13) % 360,
      rotationZ: objectType === 'wall' ? 0 : 180,
      scaleX: objectType === 'wall' ? 4 : 1.2,
      scaleY: objectType === 'wall' ? 2.4 : 1,
      scaleZ: objectType === 'wall' ? 0.16 : 0.9,
    });
    set(transformId, 'name', 'transform');

    const boundsId = `${objectId}-bounds`;
    move(boundsId, objectId);
    setProps(boundsId, {
      type: 'component',
      component: 'bounds',
      width: objectType === 'wall' ? 4 : 1.2,
      height: objectType === 'wall' ? 2.4 : 1,
      depth: objectType === 'wall' ? 0.16 : 0.9,
    });
    set(boundsId, 'name', 'bounds');

    const renderId = `${objectId}-render`;
    move(renderId, objectId);
    setProps(renderId, {
      type: 'component',
      component: 'render',
      color: objectType === 'wall' ? '#6ea8fe' : '#f5b84b',
      visible: true,
      locked: false,
      opacity: objectType === 'wall' ? 0.68 : 0.78,
    });
    set(renderId, 'name', 'render');

    const metaId = `${objectId}-meta`;
    move(metaId, objectId);
    setProps(metaId, metaPropsFor(index, objectType, isFullObject));
    set(metaId, 'name', 'meta');
  }

  if (ops.length !== EXPECTED_OP_COUNT) {
    throw new Error(`Expected ${EXPECTED_OP_COUNT} ops, got ${ops.length}`);
  }

  const moveOps = ops.filter(op => 'parentId' in op);
  if (moveOps.length !== EXPECTED_NODE_COUNT) {
    throw new Error(`Expected ${EXPECTED_NODE_COUNT} node moves, got ${moveOps.length}`);
  }

  return ops;
}

function metaPropsFor(index: number, objectType: string, includeImageFile: boolean): Props {
  const props: Props = {
    type: 'component',
    component: 'meta',
    sourceFormat: 'batch-import',
    sourceVersion: '2026-06-05',
    sourceCreatedAt: '2026-06-05T21:43:00.000Z',
    sourceIndex: index,
    sourceId: `78559-${index}`,
    sourceLayerId: `layer-${index % 6}`,
    sourceLabel: `${objectType}-${index}`,
    sourceTag: objectType,
    appearance: objectType === 'wall' ? 'painted wall' : 'imported object',
    info: `Imported object ${index}`,
    url: `https://example.invalid/import/${index}`,
    metadata: {
      platform_data: { id: `78559-${index}`, score: round(0.5 + (index % 10) * 0.03) },
      import: { source: 'generated-object-graph', kind: objectType },
    },
    spatialRelations: {
      near: [`object-${Math.max(0, index - 1)}`],
      inside: `layer-${index % 6}`,
    },
    sourceTransform: {
      position: { x: round(-12 + index * 0.37), y: 1, z: round(-8 + index * 0.29) },
      rotation_deg: { x: 0, y: (index * 13) % 360, z: 0 },
      scale_m: { x: objectType === 'wall' ? 4 : 1.2, y: objectType === 'wall' ? 2.4 : 1, z: objectType === 'wall' ? 0.16 : 0.9 },
    },
    sourceBounds: {
      min: { x: round(-0.5 - index * 0.01), y: 0, z: round(-0.5 - index * 0.01) },
      max: { x: round(0.5 + index * 0.01), y: objectType === 'wall' ? 2.4 : 1, z: round(0.5 + index * 0.01) },
    },
  };

  if (includeImageFile) {
    props.imageFile = `imported-object-${index}.png`;
  }

  return props;
}

function timestampFor(index: number): string {
  return `2026-06-05T21:${String(40 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`;
}

function orderFor(index: number): string {
  return `${String.fromCharCode(65 + (index % 26))}${Math.floor(index / 26).toString(36)}A`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
