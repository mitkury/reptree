import { RepTree } from '../dist/index.js';

// Create two replicated trees with different peer IDs
const tree1 = new RepTree('peer1');
const tree2 = new RepTree('peer2');

// Add root vertex to the first tree
const rootVertex = tree1.rootVertex;
const rootId = rootVertex.id;
console.log(`Root vertex ID: ${rootId}`);

// Add some children to the root in the first tree
const child1 = tree1.newVertex(rootId);
const child2 = tree1.newVertex(rootId);
tree1.setVertexProperty(child1.id, 'name', 'Child 1');
tree1.setVertexProperty(child2.id, 'name', 'Child 2');

// Sync the operations from tree1 to tree2
const ops = tree1.getAllOps();
tree2.merge(ops);

// Verify both trees have the same structure
console.log('Tree 1 vertices:', tree1.getAllVertices().length);
console.log('Tree 2 vertices:', tree2.getAllVertices().length);

// Make changes to tree2
const child3 = tree2.newVertex(rootId);
tree2.setVertexProperty(child3.id, 'name', 'Child 3');

// Move a vertex in tree2
tree2.moveVertex(child1.id, child2.id);

// Sync both ways
const ops2to1 = tree2.getAllOps();
tree1.merge(ops2to1);

// Now both trees should be identical
console.log('\nAfter sync:');
console.log('Tree 1 vertices:', tree1.getAllVertices().length);
console.log('Tree 2 vertices:', tree2.getAllVertices().length);

// Display tree structure
function printTree(tree: RepTree, vertexId: string, level = 0) {
  const indent = '  '.repeat(level);
  const name = tree.getVertexProperty(vertexId, 'name') || vertexId;
  console.log(`${indent}- ${name}`);
  
  const children = tree.getChildrenIds(vertexId);
  for (const childId of children) {
    printTree(tree, childId, level + 1);
  }
}

console.log('\nTree structure:');
printTree(tree1, rootId); 