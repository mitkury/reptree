This is a context for AI editor/agent about the project. It's generated with a tool Airul (https://github.com/mitkury/airul) out of 5 sources. Edit .airul.json to change sources or enabled outputs. After any change to sources or .airul.json, run `airul gen` to regenerate the context.

# From README.md:

# RepTree

A tree data structure using CRDTs for seamless replication between peers.

> 🚧 **Work in Progress**: This package is under active development and APIs may change.
>
> RepTree was created for the [Supa](https://github.com/supaorg/supa) project, an open-source alternative to ChatGPT.

## Description

RepTree uses multiple conflict-free replicated data types (CRDTs) to manage seamless replication between peers:
- A move tree CRDT is used for the tree structure (https://martin.kleppmann.com/papers/move-op.pdf).
- A last writer wins (LWW) CRDT is used for properties.
- Yjs integration for collaborative editing with various shared data types (Text, Array, Map, XML).

RepTree can also be viewed as a hierarchical, distributed database. For more details on its database capabilities, see [RepTree as a Database](docs/database.md).

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

// Helper function form
const person = bindVertex(tree, v.id, Person);

// Or via instance method on Vertex
// const person = v.bind(Person);

person.name = 'Alice'; // validated and persisted
person.age = 33;       // validated and persisted
```

#### Aliases for internal fields

- `name` ↔ `_n`
- `createdAt` ↔ `_c` (Date exposed, ISO stored)

These aliases are applied by default when using `bindVertex` or `vertex.bind()`.

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
- Filter unsupported types (non-primitive objects except Y.Doc)
- Ignore `props.name` if `newNamedChild` has an explicit `name`
- Forbid nested children in props for now

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
---

# From docs/dev/rules-for-ai.md:

# Rules for AI

## TLDR Context
It's an NPM package at https://www.npmjs.com/package/reptree
If you're not sure about what is the feature name for a commit - look at the list of commits in the git history or ask the user.

## Test often
After a big change or before committing, do "npm test"

## Commit messages
Short and concise.
Add "<scope>: <description>" suffix.

Scopes:
feat(name-of-a-feature) - any dedicated feature
docs - anything related to .md docs in /docs directory
test - anything related to tests
bench - anything related to benchmarks

## Publishing
1. Commit changes with descriptive message
2. Run "npm version patch" (or minor/major) to bump version
3. Push the tag to trigger the release workflow:
   ```
   git push origin v[version]  # e.g., git push origin v0.4.5
   ```
4. Run "npm publish" to publish to npm
---

# From package.json:

{
  "name": "reptree",
  "version": "0.2.3",
  "description": "A tree data structure using CRDTs for seamless replication between peers",
  "main": "dist/index.cjs",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": [
    "dist",
    "README.md"
  ],
  "scripts": {
    "preinstall": "airul gen",
    "prebuild": "rm -rf dist",
    "build": "tsup",
    "dev": "tsup --watch",
    "pretest": "npm run build",
    "test": "vitest",
    "prepublishOnly": "npm run build",
    "pretest:light": "npm run build",
    "test:light": "vitest run --config vitest.light.config.ts"
  },
  "keywords": [
    "crdt",
    "tree",
    "data-structure",
    "replication"
  ],
  "author": "Dmitry Kury (d@dkury.com)",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/mitkury/reptree.git"
  },
  "homepage": "https://github.com/mitkury/reptree#readme",
  "bugs": {
    "url": "https://github.com/mitkury/reptree/issues"
  },
  "devDependencies": {
    "ts-node": "^10.9.1",
    "tsup": "^8.0.1",
    "typescript": "^5.2.2",
    "vitest": "^1.0.0",
    "zod": "^4.0.0",
    "airul": "^0.1.39"
  },
  "dependencies": {
    "yjs": "^13.6.26"
  }
}
---

# From docs/vector-states.md:

# Range-Based State Vectors in RepTree

## Overview

RepTree uses range-based state vectors to track which operations have been applied across peers. This approach allows for compact representation of operation history and optimized synchronization by identifying only the missing operations that need to be transferred.

## Implementation

### State Vector Structure

A state vector is represented as a mapping from peer IDs to arrays of ranges:

```typescript
// Type: Record<peerId, number[][]>
// Example: { "peer1": [[1, 5], [8, 10]], "peer2": [[1, 7]] }
```

Each range `[start, end]` represents a continuous sequence of operations with counters from `start` to `end` (inclusive) that have been applied from that peer.

RepTree encapsulates this functionality in a dedicated `StateVector` class that handles all state vector operations, providing a clean interface for the rest of the system.

### Key Algorithms

#### Incremental Maintenance

The state vector is continuously updated as operations are applied:

1. When an operation is applied, its peer ID and counter are extracted
2. The corresponding range array for that peer is located or created
3. The system then either:
   - Extends an existing range if the counter is adjacent to it
   - Merges ranges if extending one range connects it to another
   - Creates a new range if the counter isn't adjacent to any existing range

#### Range Operations

The system includes a `subtractRanges` helper function that calculates the set difference between two range sets. This is used to determine which operations one peer has that another doesn't.

#### Missing Operations Calculation

To determine what operations to send during synchronization:

1. Calculate missing ranges by comparing state vectors to identify ranges one peer has that the other doesn't
2. Filter all operations to find those falling within these missing ranges
3. Sort the resulting operations to ensure causal order preservation

## Benefits

1. **Compact Representation**: Continuous sequences of operations are represented as single ranges
2. **Efficient Synchronization**: Only missing operations are transferred between peers
3. **Handles Gaps**: Non-contiguous operations are efficiently represented as separate ranges
4. **Incremental Updates**: State vectors are maintained in real-time as operations are applied
5. **Modular Design**: Separation of concerns with a dedicated StateVector class

## Synchronization Protocol

1. Peer A sends its state vector to Peer B
2. Peer B calculates missing operations by comparing state vectors
3. Peer B sends only the missing operations to Peer A
4. Peer A applies these operations, automatically updating its state vector

This approach minimizes network usage and ensures efficient operation transfer during synchronization.

## Usage in RepTree

The state vector functionality in RepTree:

- Is enabled by default
- Can be toggled on/off with the `stateVectorEnabled` property
- Will automatically rebuild from existing operations when re-enabled
---

# From docs/reactive-vertices.md:

# Reactive Vertices

RepTree can expose a vertex as a live JavaScript object so you can read/write properties without thinking about CRDT plumbing. Reads reflect the latest CRDT state; writes persist via `setVertexProperty`.

## Binding a Vertex

```ts
import { RepTree, bindVertex } from 'reptree';

const tree = new RepTree('peer1');
const root = tree.createRoot();
const v = root.newChild();

const person = bindVertex(tree, v.id);

person.name = 'Alice'; // persisted to CRDT
person.age = 33;       // persisted to CRDT

// If CRDT updates elsewhere, reads reflect the latest state
console.log(person.name); // 'Alice'
```

### Public aliases for internal fields

- name ↔ `_n`
- createdAt ↔ `_c` (stored as ISO string; exposed as Date)

These aliases are applied by default when using `bindVertex` or `vertex.bind()`.

```ts
person.name = 'Alice';              // writes _n = 'Alice'
person.createdAt = new Date();      // writes _c = ISO string
console.log(person.createdAt);      // Date instance
```

You can customize aliasing via options:

```ts
import { defaultAliases } from 'reptree';

const custom = v.bind({
  schema: Person,
  aliases: defaultAliases,
  includeInternalKeys: false,
});
```

## Zod v4 Validation (Optional)

You can provide a [Zod v4](https://zod.dev/v4) schema to validate writes and optionally coerce values.

```ts
import { z } from 'zod';
import { bindVertex } from 'reptree';

const Person = z.object({
  name: z.string(),
  age: z.number().int().min(0)
});

const person = bindVertex(tree, v.id, Person);

person.name = 'Bob'; // ok
person.age = 34;     // ok, validated
// person.age = -1;  // throws
```

- The returned object is a Proxy that forwards reads/writes to the vertex.
- If a schema is provided, it validates writes. Field-level validation is used when available via `schema.shape`, otherwise a safe whole-object validation is attempted.

## Creating children with normalized props

`vertex.newChild(props)` and `vertex.newNamedChild(name, props)` accept plain objects. RepTree will:

- Map `name` → `_n`, and `createdAt` (Date) → `_c` (ISO string)
- Filter unsupported types (non-primitive objects except Y.Doc)
- Ignore `props.name` if `newNamedChild` receives an explicit `name` argument
- Forbid nested children in props for now

```ts
const child = root.newChild({
  name: 'ChildA',
  createdAt: new Date(),
  age: 5,
});
// Internally stores _n, _c, age

const child2 = root.newNamedChild('Folder', { name: 'ignored', flag: true });
// Uses explicit name 'Folder'; props.name is ignored
```

## Svelte 5 Integration

Svelte 5 can wrap the reactive object in a state:

```ts
<script lang="ts">
  import { RepTree, bindVertex } from 'reptree';
  import { z } from 'zod';

  const tree = new RepTree('peer1');
  const root = tree.createRoot();
  const v = root.newChild();

  const Person = z.object({ name: z.string(), age: z.number().int().min(0) });
  const person = bindVertex(tree, v.id, Person);

  const personState = $state(person);
</script>

<input bind:value={personState.name} />
<input type="number" bind:value={personState.age} />
```

As the user edits the inputs, the underlying vertex is updated and persisted. If CRDT updates arrive from other peers, the bound values reflect them on read.

## Notes

- This is opt-in; core remains free of a hard Zod dependency. The helper accepts any schema-like with `safeParse` and optional `shape`.
- For snapshot validation instead of a live object, use `tree.parseVertex(id, schema)`.
- Yjs documents are supported as vertex properties; you can bind them separately using Yjs APIs.