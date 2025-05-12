import { RepTree } from '../src';
import { VertexOperation } from '../src/operations';
import * as Y from 'yjs';
import { describe, test, expect } from 'vitest';

test('Just yjs without RepTree', () => {
  const ydoc = new Y.Doc();

  let upds: Uint8Array[] = [];
  ydoc.on('update', (upd) => {
    upds.push(upd);
  });

  upds.push(Y.encodeStateAsUpdate(ydoc));
  const ytext = ydoc.getText('default');
  ytext.insert(0, 'Hello,');
  ytext.insert(ytext.length, ' world!');

  expect(ytext.toString()).toBe('Hello, world!');

  const ydoc2 = new Y.Doc();

  expect(ydoc2.getText('default').toString()).toBe('');

  for (const upd of upds) {
    Y.applyUpdate(ydoc2, upd);
  }

  expect(ydoc2.getText('default').toString()).toBe('Hello, world!');
});

test('Replication', () => {
  const tree = new RepTree('peer1');
  const root = tree.createRoot();

  // Create a Yjs document
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('default');

  // Set it as a property
  tree.setVertexProperty(root.id, 'content', ydoc);

  ytext.insert(0, 'Hello, world!');

  // createTreeFromOps(ops)
  // duplicateTree(tree)

  const retrievedDoc = tree.getVertexProperty(root.id, 'content') as Y.Doc;
  expect(retrievedDoc).toBeInstanceOf(Y.Doc);
  expect(retrievedDoc.getText('default').toString()).toBe('Hello, world!');

  const tree2 = new RepTree('peer2');
  tree2.merge(tree.getAllOps());

  // Retrieve and verify
  const retrievedDoc2 = tree2.getVertexProperty(root.id, 'content') as Y.Doc;
  expect(retrievedDoc2).toBeInstanceOf(Y.Doc);
  expect(retrievedDoc2.getText('default').toString()).toBe('Hello, world!');
});