import { describe, test } from "vitest";
import { RepTree, bindVertex } from '../dist/index.js';
import { z } from 'zod';

describe('examples should work', () => {
  test('should work with the example from README', () => {
    // Create a tree with a root
    const tree = new RepTree('company-org-1');
    const company = tree.createRoot();

    // Create a node (we call them vertices in RepTree) in the root of our new tree
    const devs = company.newNamedChild("developers");
    const qa = company.newNamedChild("qa");

    // Create a vertex in another vertex
    const alice = qa.newChild();

    // Set properties
    alice.setProperty('name', 'Alice');
    alice.setProperty('age', 32);

    // Move the vertex inside a different vertex
    alice.moveTo(devs);

    // Bind a vertex to a type to set its properties like regular fields
    const bob = qa.newChild().bind<{ name: string, age: number }>();
    bob.name = "Bob";
    bob.age = 33;

    // Use a Zod type for runtime type checks
    const Person = z.object({ name: z.string(), age: z.number().int().min(0) });
    const casey = devs.newNamedChild("Casey").bind(Person);
    casey.name = "Casey";
    casey.age = 34;
  });

  test('should work with another simple example', () => {
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
      meta: { dimensions: "512x512", format: "png" },
      s3Path: "s3://my-bucket/images/logo.png",
    });

    // Move a file to a different folder
    logoFile.moveTo(docsFolder);

    // Get children of a folder
    const docsFolderContents = docsFolder.children;

    // JSON prop checks
    expect(logoFile.getProperty('meta')).toEqual({ dimensions: '512x512', format: 'png' });

    // Syncing between trees
    const otherTree = new RepTree("peer2");
    const ops = tree.getAllOps();
    otherTree.merge(ops);
  });
});