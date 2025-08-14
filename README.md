# RepTree

A tree data structure using CRDTs for seamless replication between peers.

> 🚧 **Work in Progress**: This package is under active development and APIs may change.
>
> RepTree was created for the [Supa](https://github.com/supaorg/supa) project, an open-source alternative to ChatGPT.

## How RepTree works (brief)

RepTree maintains a replicated tree with two CRDTs:
- Move-tree CRDT for structure (see Martin Kleppmann’s move op paper). Each vertex can move under a new parent; conflicting moves are resolved deterministically by an undo/do/redo algorithm ordered by Lamport timestamps.
- Last-Writer-Wins (LWW) for properties. Non-Yjs properties resolve by taking the most recent op per key.
- Optional Yjs integration stores collaborative documents as properties. RepTree listens to Yjs updates and turns them into prop ops.

Replication is op-based: peers exchange operations and converge to the same structure and properties. State-vectors can be used to send only the ops a peer is missing.

## External storage (optional; Node)

For large trees and long histories, you can offload the snapshot and/or logs to an external store (SQLite adapter provided). The in-memory state remains the hot working set; additional data is paged from storage via async helpers.

- Pass storage adapters at construction time:
  ```ts
  import Database from 'better-sqlite3';
  import {
    RepTree,
    SqliteVertexStore,
    SqliteJsonLogStore,
    ensureRepTreeSchema,
  } from 'reptree';

  const db = new Database('reptree.db');
  ensureRepTreeSchema(db);

  const tree = new RepTree('peer1', {
    vertexStore: new SqliteVertexStore(db),
    moveLog: new SqliteJsonLogStore(db, 'rt_move_ops'),
    propLog: new SqliteJsonLogStore(db, 'rt_prop_ops'),
    opMemoryLimit: 50_000, // keep only newest N ops in memory
  });
  ```
- Use async helpers to page data when it’s not already in memory:
  - `getVertexAsync`, `getChildrenAsync`, `getChildrenIdsAsync`
  - `getVertexPropertyAsync`, `getVertexPropertiesAsync`
  - `getMissingOpsAsync(stateVector)` streams missing ops from external logs
- The synchronous API still works and reads from the in-memory snapshot. It remains the default surface for v1.

For details, see `docs/big-trees.md`.

## Installation

```bash
npm install reptree
```

## Usage

### Reactive vertex with Zod (optional)

```ts
import { RepTree, bindVertex } from 'reptree';
import { z } from 'zod';

const tree = new RepTree('peer1');
const root = tree.createRoot();
const v = root.newChild();

const Person = z.object({ name: z.string(), age: z.number().int().min(0) });
const person = bindVertex(tree, v.id, Person);

person.name = 'Alice'; // validated and persisted
person.age = 33;       // validated and persisted
```

For more, see `docs/reactive-vertices.md`. 

```typescript
import { RepTree } from 'reptree';

// Create a new tree
const tree = new RepTree('peer1');
const root = tree.createRoot();
root.name = 'Project';

// Create a folder structure with properties
const docsFolder = root.newNamedChild('Docs');
docsFolder.setProperties({
  type: 'folder',
  icon: 'folder-icon'
});

const imagesFolder = root.newNamedChild('Images');
imagesFolder.setProperties({
  type: 'folder',
  icon: 'image-icon'
});

// Add files to folders
const readmeFile = docsFolder.newNamedChild('README.md');
readmeFile.setProperties({
  type: 'file',
  size: 2048,
  lastModified: '2023-10-15T14:22:10Z',
  s3Path: 's3://my-bucket/docs/README.md'
});

const logoFile = imagesFolder.newNamedChild('logo.png');
logoFile.setProperties({
  type: 'file',
  size: 15360,
  dimensions: '512x512',
  format: 'png',
  s3Path: 's3://my-bucket/images/logo.png'
});

// Move a file to a different folder
logoFile.moveTo(docsFolder);

// Get children of a folder
const docsFolderContents = docsFolder.children;

// Syncing between trees
const otherTree = new RepTree('peer2');
const ops = tree.getAllOps();
otherTree.merge(ops);
```

## Yjs Integration

RepTree supports [Yjs](https://github.com/yjs/yjs) documents as vertex properties, enabling real-time collaborative editing with a variety of shared data types:

```typescript
import { RepTree } from 'reptree';
import * as Y from 'yjs';

// Create a tree with a root vertex
const tree = new RepTree('peer1');
const root = tree.createRoot();

// Create a Yjs document
const ydoc = new Y.Doc();
const ytext = ydoc.getText('default');
ytext.insert(0, 'Hello world');

// Set the Yjs document as a property
root.setProperty('content', ydoc);

// Later, retrieve and modify the document
const retrievedDoc = root.getProperty('content') as Y.Doc;
retrievedDoc.getText('default').insert(retrievedDoc.getText('default').length, '!');

// Sync operations with another tree
const tree2 = new RepTree('peer2');
tree2.merge(tree.popLocalOps());

// Both trees now have the same Yjs document content
const root2 = tree2.root;
const doc2 = root2.getProperty('content') as Y.Doc;
console.log(doc2.getText('default').toString()); // 'Hello world!'
```

This integration allows for:
- Collaborative editing with multiple shared data types:
  - **Y.Text** - For rich text editing with formatting attributes
  - **Y.Array** - For ordered collections of data
  - **Y.Map** - For key-value pairs and structured data
  - **Y.XmlFragment/Y.XmlElement** - For XML-like structured content
- Complex nested data structures (arrays within maps, maps within arrays, etc.)
- Automatic CRDT synchronization between peers
- Conflict-free concurrent editing
- Integration with existing Yjs ecosystem (editors, frameworks, etc.)

## License

MIT