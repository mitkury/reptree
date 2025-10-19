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

#### Field behavior

- `name` is stored directly as `name`.
- `createdAt` is stored as `_c` (ISO string).

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

- Filter unsupported types (non-primitive objects)
- Ignore `props.name` if `newNamedChild` has an explicit `name`
- Forbid nested children in props for now
## Yjs

We previously supported Yjs in this repository, but it has been removed to keep the core library lightweight. If you need Yjs integration, see `docs/yjs.md` and the `yjs-2025` branch.

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
  "version": "0.4.0",
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
    "prepublishOnly": "npm run build"
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
    "airul": "^0.1.39",
    "jsdom": "^27.0.0",
    "ts-node": "^10.9.1",
    "tsup": "^8.0.1",
    "typescript": "^5.2.2",
    "vitest": "^1.0.0",
    "zod": "^4.0.0"
  },
  "dependencies": {
    
  }
}
---

# From docs/vector-states.md:

# Range-Based State Vectors in RepTree

## Overview

RepTree uses range-based state vectors to track which operations have been applied across peers. This approach allows for compact representation of operation history and optimized synchronization by identifying only the missing operations that need to be transferred.

## Implementation

### State Vector Structure

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

# From docs/reactive-vertices.md:

# Reactive Vertices

RepTree can expose a vertex as a live JavaScript object so you can read/write properties without thinking about CRDT plumbing.

## Binding a Vertex

```ts
import { RepTree } from 'reptree';

const tree = new RepTree('peer1');
const root = tree.createRoot();
const v = root.newChild();

const person = v.bind();

person.name = 'Alice'; // persisted to CRDT
person.age = 33;       // persisted to CRDT

// If updates arrive from other peers, reads reflect the latest state
console.log(person.name); // 'Alice'
```

### Vertex properties and methods

Bound vertices expose tree navigation and manipulation via `$`-prefixed properties and methods (following Vue.js convention):

```ts
const bound = v.bind();

// Properties (read-only)
bound.$id            // vertex ID
bound.$parentId      // parent vertex ID or null
bound.$parent        // parent Vertex instance or undefined
bound.$children      // array of child Vertex instances
bound.$childrenIds   // array of child IDs

// Methods
bound.$moveTo(parent)              // move to new parent (accepts Vertex, BindedVertex, or ID)
bound.$delete()                    // delete vertex (moves to NULL parent)
bound.$newChild(props)             // create child vertex
bound.$newNamedChild(name, props)  // create named child vertex
bound.$observe(listener)           // observe changes, returns unsubscribe function
bound.$observeChildren(listener)   // observe children changes
```

Example usage:

```ts
const folderVertex = tree.getVertex(folderId);
const folder = folderVertex.bind(FolderSchema);

// Create and manipulate children
const file = folder.$newNamedChild('README.md', { size: 1024 });
file.$moveTo(otherFolder);

// Observe changes (batched, ~33ms intervals)
const unobserve = folder.$observeChildren(children => {
  console.log('Children changed:', children.length);
});

// Later: unobserve()
```

All vertex properties and methods are read-only and cannot be overwritten.

### Field behavior

- name ↔ `_n`
- createdAt ↔ `_c` (stored as ISO string; exposed as Date)

## Zod v4 Validation (Optional)

You can provide a [Zod v4](https://zod.dev/v4) schema to validate writes and optionally coerce values.

```ts
import { RepTree } from 'reptree';
import { z } from 'zod';

const tree = new RepTree('peer1');
const root = tree.createRoot();
const v = root.newChild();

const Person = z.object({
  name: z.string(),
  age: z.number().int().min(0)
});

const person = v.bind(Person);

person.name = 'Bob'; // ok
person.age = 34;     // ok, validated
// person.age = -1;  // throws
```

**How it works**:
- Bound vertices are Proxies for dynamic property access
- If a schema is provided, writes are validated using field-level validation via `schema.shape`

## Transient writes (drafts)

RepTree supports transient (non‑persistent) overlays for quick UI drafts.

- **useTransient(fn)**: apply transient edits that override reads but do not persist yet.
- **commitTransients()**: promote current transient overlays to persistent values.

```ts
const person = v.bind(Person);

// Draft changes (not yet persistent)
person.$useTransients(p => {
  p.name = 'Alice (draft)';   // transient overlay
  p.age = 34;                 // transient overlay
});

console.log(person.name); // 'Alice (draft)' — reads include transients

// Promote all transient overlays to persistent CRDT properties
person.$commitTransients();

// Now reads reflect the persisted values even without the overlay
console.log(person.name); // 'Alice (draft)'
```

Notes:

- If a schema is provided, transient writes are validated/coerced the same as persistent writes; `commitTransients()` persists the validated values.
- Persistent writes with a newer operation automatically clear the transient overlay for that key.

### Creating children with normalized props

`vertex.newChild(props)` and `vertex.newNamedChild(name, props)` accept plain objects. RepTree will:

- Filter unsupported types (non-primitive objects)
- Ignore `props.name` if `newNamedChild` receives an explicit `name` argument
- Forbid nested children in props for now

```ts
const child = root.newChild({
  name: 'ChildA',
  _c: new Date().toISOString(),
  age: 5,
});
// Stores name, _c, age

const child2 = root.newNamedChild('Folder', { name: 'ignored', flag: true });
// Uses explicit name 'Folder'; props.name is ignored
```

## Integration Notes

- Bound vertices are framework-agnostic JavaScript objects (via Proxy)
- Use your UI framework's preferred state mechanism to manage references to bound vertices

## Notes

- This is opt-in; core remains free of a hard Zod dependency. The helper accepts any schema-like with `safeParse` and optional `shape`.
- For snapshot validation instead of a live object, use `tree.parseVertex(id, schema)`.
- Yjs integration is not included in this branch. See `docs/yjs.md` and the `yjs-2025` branch for details.
