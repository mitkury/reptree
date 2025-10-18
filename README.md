# RepTree - replicated trees with properties

A JavaScript tree data structure for storing and syncing app state. It can be used both to represent and persist the state in the frontend and backend.

RepTree uses [CRDTs](https://crdt.tech/) for seamless replication between users.

> RepTree was created for the [Sila](https://github.com/silaorg/sila) project, an open-source alternative to ChatGPT.

## What it solves

If you have a tree structure in your app where each vertex/node/leaf can be moved independently by multiple users, you need a solution that resolves conflicts when the same vertex is moved in different ways. Otherwise your tree can diverge or form loops. This includes folder structures (people creating and moving folders), 2D/3D scenes with objects being moved and parented, and Notion‑like documents where blocks with text and other properties are edited by users.

You probably also want properties on each vertex/node/leaf and to have them sync correctly between peers without conflicts. RepTree syncs properties too.

## Getting started

```bash
npm install reptree
```

### Example 1 
```ts
import { RepTree } from "reptree";

// Create a tree with a root
const tree = new RepTree("company-org-1");
const company = tree.createRoot();

// Create a node (we call them vertices in RepTree) in the root of our new tree
const devs = company.newNamedChild("developers");
const qa = company.newNamedChild("qa");

// Create a vertex in another vertex
const alice = qa.newChild();

// Set properties
alice.setProperty("name", "Alice");
alice.setProperty("age", 32);

// Move the vertex inside a different vertex
alice.moveTo(devs);

// Bind a vertex to a type to set its properties like regular fields
const bob = qa.newChild().bind<{ name: string; age: number }>();
bob.name = "Bob";
bob.age = 33;

// Use a Zod type for runtime type checks
import { z } from "zod";
const Person = z.object({ name: z.string(), age: z.number().int().min(0) });
const casey = devs.newNamedChild("Casey").bind(Person);
casey.name = "Casey";
casey.age = 34;
```

### Example 2

```typescript
import { RepTree } from "reptree";

// Create a new tree
const tree = new RepTree("peer1");
const root = tree.createRoot();
root.name = "Project";

// Create a folder structure with properties
const docsFolder = root.newNamedChild("Docs");
docsFolder.setProperties({
  type: "folder",
  icon: "folder-icon",
});

const imagesFolder = root.newNamedChild("Images");
imagesFolder.setProperties({
  type: "folder",
  icon: "image-icon",
});

// Add files to folders
const readmeFile = docsFolder.newNamedChild("README.md");
readmeFile.setProperties({
  type: "file",
  size: 2048,
  lastModified: "2023-10-15T14:22:10Z",
  s3Path: "s3://my-bucket/docs/README.md",
});

const logoFile = imagesFolder.newNamedChild("logo.png");
logoFile.setProperties({
  type: "file",
  size: 15360,
  dimensions: "512x512",
  format: "png",
  s3Path: "s3://my-bucket/images/logo.png",
});

// Move a file to a different folder
logoFile.moveTo(docsFolder);

// Get children of a folder
const docsFolderContents = docsFolder.children;

// Syncing between trees
const otherTree = new RepTree("peer2");
const ops = tree.getAllOps();
otherTree.merge(ops);
```

## CRDTs

RepTree uses two conflict-free replicated data types (CRDTs):
- A move tree CRDT for the tree structure (https://martin.kleppmann.com/papers/move-op.pdf).
- A last-writer-wins (LWW) CRDT is for properties.

## License

MIT
