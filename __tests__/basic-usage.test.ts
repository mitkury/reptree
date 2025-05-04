import { describe, test, expect } from 'vitest';
import { RepTree } from '../dist/index.js';

describe('RepTree Basic Usage', () => {
  test('should work with the example from README', () => {
    // Create a new tree
    const tree = new RepTree('peer1');

    const rootVertex = tree.createRoot();
    rootVertex.name = 'Project';

    // Create a folder structure with properties
    const docsFolder = rootVertex.newNamedChild('Docs');
    docsFolder.setProperties({
      type: 'folder',
      icon: 'folder-icon'
    });

    const imagesFolder = rootVertex.newNamedChild('Images');
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

    // Verify the structure
    expect(rootVertex.name).toBe('Project');
    
    // Verify children
    expect(rootVertex.childrenIds.length).toBe(2);
    
    // Verify docs folder content
    expect(docsFolder.childrenIds.length).toBe(2);
    expect(docsFolder.getProperty('type')).toBe('folder');
    
    // Check if logo was moved successfully
    expect(docsFolderContents.some(child => child.id === logoFile.id)).toBe(true);
    expect(imagesFolder.childrenIds.length).toBe(0);

    // Syncing between trees
    const otherTree = new RepTree('peer2');
    const ops = tree.getAllOps();
    otherTree.merge(ops);

    // Verify that second tree has the same structure using the built-in compareStructure method
    expect(tree.compareStructure(otherTree)).toBe(true);
    
    // Additional verification of a specific property to show how we could check individual elements
    const otherRootVertex = otherTree.root;
    expect(otherRootVertex?.name).toBe('Project');
  });
}); 