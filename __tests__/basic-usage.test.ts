import { describe, test, expect } from 'vitest';
import { RepTree } from '../dist/index.js';

describe('RepTree Basic Usage', () => {
  test('should work with the example from README', () => {
    // Create a new tree
    const tree = new RepTree('peer1');

    // Root vertex is created automatically
    const rootVertex = tree.rootVertex;
    const rootId = rootVertex.id;
    tree.setVertexProperty(rootId, 'name', 'Project');

    // Create a folder structure with properties
    const docsFolder = tree.newVertex(rootId);
    tree.setVertexProperty(docsFolder.id, 'name', 'Docs');
    tree.setVertexProperty(docsFolder.id, 'type', 'folder');
    tree.setVertexProperty(docsFolder.id, 'icon', 'folder-icon');

    const imagesFolder = tree.newVertex(rootId);
    tree.setVertexProperty(imagesFolder.id, 'name', 'Images');
    tree.setVertexProperty(imagesFolder.id, 'type', 'folder');
    tree.setVertexProperty(imagesFolder.id, 'icon', 'image-icon');

    // Add files to folders
    const readmeFile = tree.newVertex(docsFolder.id);
    tree.setVertexProperty(readmeFile.id, 'name', 'README.md');
    tree.setVertexProperty(readmeFile.id, 'type', 'file');
    tree.setVertexProperty(readmeFile.id, 'size', 2048);
    tree.setVertexProperty(readmeFile.id, 'lastModified', '2023-10-15T14:22:10Z');
    tree.setVertexProperty(readmeFile.id, 's3Path', 's3://my-bucket/docs/README.md');

    const logoFile = tree.newVertex(imagesFolder.id);
    tree.setVertexProperty(logoFile.id, 'name', 'logo.png');
    tree.setVertexProperty(logoFile.id, 'type', 'file');
    tree.setVertexProperty(logoFile.id, 'size', 15360);
    tree.setVertexProperty(logoFile.id, 'dimensions', '512x512');
    tree.setVertexProperty(logoFile.id, 'format', 'png');
    tree.setVertexProperty(logoFile.id, 's3Path', 's3://my-bucket/images/logo.png');

    // Move a file to a different folder
    tree.moveVertex(logoFile.id, docsFolder.id);

    // Verify the structure
    expect(tree.getVertexProperty(rootId, 'name')).toBe('Project');
    
    // Verify children
    expect(tree.getChildrenIds(rootId).length).toBe(2);
    
    // Verify docs folder content
    expect(tree.getChildrenIds(docsFolder.id).length).toBe(2);
    expect(tree.getVertexProperty(docsFolder.id, 'type')).toBe('folder');
    
    // Check if logo was moved successfully
    const docsFolderContents = tree.getChildrenIds(docsFolder.id);
    expect(docsFolderContents.includes(logoFile.id)).toBe(true);
    expect(tree.getChildrenIds(imagesFolder.id).length).toBe(0);

    // Syncing between trees
    const otherTree = new RepTree('peer2');
    const ops = tree.getAllOps();
    otherTree.merge(ops);

    // Verify that second tree has the same structure using the built-in compareStructure method
    expect(tree.compareStructure(otherTree)).toBe(true);
    
    // Additional verification of a specific property to show how we could check individual elements
    expect(otherTree.getVertexProperty(rootId, 'name')).toBe('Project');
  });
}); 