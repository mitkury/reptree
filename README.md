# RepTree

A tree data structure using CRDTs for seamless replication between peers.

> 🚧 **Work in Progress**: This package is under active development and APIs may change.
>
> RepTree was created for the [Supa](https://github.com/supaorg/supa) project, an open-source alternative to ChatGPT.

## Description

RepTree uses multiple conflict-free replicated data types (CRDTs) to manage seamless replication between peers:
- A move tree CRDT is used for the tree structure (https://martin.kleppmann.com/papers/move-op.pdf).
- A last writer wins (LWW) CRDT is used for properties.
Note: Yjs integration was removed in this branch to keep the core lightweight. See `docs/yjs.md`.

RepTree can also be viewed as a hierarchical, distributed database. For more details on its database capabilities, see [RepTree as a Database](docs/database.md).

## Installation

```bash
npm install reptree
```

## Usage

### Reactive vertex with Zod (optional)

```ts
import { RepTree } from 'reptree';
import { z } from 'zod';

const tree = new RepTree('peer1');
const root = tree.createRoot();
const v = root.newChild();

const Person = z.object({ name: z.string(), age: z.number().int().min(0) });

const person = v.bind(Person);

person.name = 'Alice'; // validated and persisted
person.age = 33;       // validated and persisted
```

#### Aliases for internal fields

- `name` ↔ `_n`
- `createdAt` ↔ `_c` (Date exposed, ISO stored)

These aliases are applied by default when using `vertex.bind()`.

```ts
person.name = 'Alice';          // writes _n
person.createdAt = new Date();  // writes _c (ISO)
console.log(person.createdAt instanceof Date); // true
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

### Creating children with normalized props

`vertex.newChild(props)` and `vertex.newNamedChild(name, props)` accept plain objects. RepTree will:

- Map `name` → `_n`, `createdAt` (Date) → `_c` (ISO)
- Filter unsupported types (non-primitive objects)
- Ignore `props.name` if `newNamedChild` has an explicit `name`
- Forbid nested children in props for now
## Yjs

We previously supported Yjs in this repository, but it has been removed to keep the core library lightweight. If you need Yjs integration, see `docs/yjs.md` and the `yjs-2025` branch.

## License

MIT