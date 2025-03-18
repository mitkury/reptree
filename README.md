# RepTree

A tree data structure using CRDTs for seamless replication between peers.

## Description

RepTree is a tree data structure for storing vertices with properties.
It uses 2 conflict-free replicated data types (CRDTs) to manage seamless replication between peers:
- A move tree CRDT is used for the tree structure (https://martin.kleppmann.com/papers/move-op.pdf).
- A last writer wins (LWW) CRDT is used for properties.

## Installation

```bash
npm install reptree
# or
yarn add reptree
# or
pnpm add reptree
```

## Usage

```typescript
import { RepTree } from 'reptree';

// Create a new tree
const tree = new RepTree('peer1');

// Root vertex is created automatically
const rootVertex = tree.rootVertex;
const rootId = rootVertex.id;

// Add child vertices
const childVertex = tree.newVertex(rootId);
const childId = childVertex.id;

// Set properties
tree.setVertexProperty(childId, 'name', 'Child Node');

// Move vertices
tree.moveVertex(childId, anotherParentId);

// Syncing between trees
const otherTree = new RepTree('peer2');
const ops = tree.getAllOps();
otherTree.merge(ops);
```

## License

MIT