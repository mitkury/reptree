import { describe, test, expect } from 'vitest';
import { RepTree } from '../dist/index.js';
import { 
  createTestTrees,
  executeRandomAction,
  runAllOpsFuzzyTest
} from './utils/fuzzy-test-utils';

// Helper function to print tree structure
function printTreeStructure(label: string, tree: RepTree) {
  console.log(`\n--- ${label} ---`);
  console.log(`Total vertices: ${tree.getAllVertices().length}`);
  console.log(`Root ID: ${tree.root?.id}`);
  
  const printVertex = (vertex: any, depth: number = 0) => {
    const indent = '  '.repeat(depth);
    const props = Object.entries(vertex.properties || {})
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
    
    console.log(`${indent}- ${vertex.id}: ${vertex.name || '(unnamed)'} ${props ? `(${props})` : ''}`);
    
    const children = tree.getChildrenIds(vertex.id).map(id => tree.getVertex(id));
    children.forEach(child => printVertex(child, depth + 1));
  };
  
  if (tree.root) {
    printVertex(tree.root);
  } else {
    console.log('No root vertex');
  }
  console.log('-------------------\n');
}

describe('RepTree Structure Comparison', () => {
  test('simple tree duplicate should have identical structure', () => {
    // Create a base tree with some structure
    const originalTree = new RepTree('original');
    originalTree.createRoot();
    originalTree.root!.name = 'Project';
    
    // Create some child vertices with properties
    const docs = originalTree.root!.newNamedChild('Docs');
    docs.setProperties({ type: 'folder', icon: 'folder-icon' });
    
    const readme = docs.newNamedChild('README.md');
    readme.setProperties({ type: 'file', size: 2048 });
    
    const images = originalTree.root!.newNamedChild('Images');
    images.setProperties({ type: 'folder', icon: 'image-icon' });
    
    const logo = images.newNamedChild('logo.png');
    logo.setProperties({ type: 'file', size: 15360, format: 'png' });
    
    // Create a duplicate by transferring all operations
    const duplicateTree = new RepTree('duplicate');
    duplicateTree.merge(originalTree.getAllOps());
    
    // Verify structures are identical
    expect(originalTree.compareStructure(duplicateTree)).toBe(true);
    
    // Compare string representations
    const originalStr = originalTree.printTree();
    const duplicateStr = duplicateTree.printTree();
    console.log('Original tree structure:');
    console.log(originalStr);
    console.log('Duplicate tree structure:');
    console.log(duplicateStr);
    expect(originalStr).toBe(duplicateStr);
    
    // Additional verification of vertices count
    expect(duplicateTree.getAllVertices().length).toBe(originalTree.getAllVertices().length);
  });
  
  test('duplicate with one additional operation should have different structure', () => {
    // Create a base tree with some structure
    const originalTree = new RepTree('original');
    originalTree.createRoot();
    const rootFolder = originalTree.root!;
    rootFolder.name = 'Project';
    
    // Create a child vertex
    const docsFolder = rootFolder.newNamedChild('Docs');
    
    // Create a duplicate by transferring all operations
    const duplicateTree = new RepTree('duplicate');
    duplicateTree.merge(originalTree.getAllOps());
    
    // Verify structures are identical before the extra operation
    expect(originalTree.compareStructure(duplicateTree)).toBe(true);
    
    // Compare string representations
    const originalStr = originalTree.printTree();
    const duplicateStr = duplicateTree.printTree();
    expect(originalStr).toBe(duplicateStr);
    
    // Add one more operation to the duplicate tree
    const duplicateDocs = duplicateTree.getVertex(docsFolder.id)!;
    duplicateDocs.newNamedChild('NewFile.md');
    
    // Verify structures are now different
    expect(originalTree.compareStructure(duplicateTree)).toBe(false);
    
    // Compare string representations again
    const originalStrAfter = originalTree.printTree();
    const duplicateStrAfter = duplicateTree.printTree();
    console.log('Original tree after:');
    console.log(originalStrAfter);
    console.log('Duplicate tree after:');
    console.log(duplicateStrAfter);
    expect(originalStrAfter).not.toBe(duplicateStrAfter);
    
    // Sync the original tree to match the duplicate
    originalTree.merge(duplicateTree.getAllOps());
    
    // Verify structures are identical again after syncing
    expect(originalTree.compareStructure(duplicateTree)).toBe(true);
    
    // Compare string representations after sync
    const originalStrSync = originalTree.printTree();
    const duplicateStrSync = duplicateTree.printTree();
    expect(originalStrSync).toBe(duplicateStrSync);
  });
  
  test('duplicate from quick fuzzy test should have identical structure', () => {
    // Setup parameters for a small fuzzy test
    const treesCount = 2;
    const rounds = 2;
    const actionsPerRound = 50;
    
    // Run a fuzzy test to generate a tree with random operations
    const result = runAllOpsFuzzyTest(treesCount, rounds, actionsPerRound);
    const originalTree = result.trees[0];
    
    // Create a duplicate by transferring all operations
    const duplicateTree = new RepTree('duplicate');
    duplicateTree.merge(originalTree.getAllOps());
    
    // Verify structures are identical using compareStructure
    expect(originalTree.compareStructure(duplicateTree)).toBe(true);
    
    // Get string representations
    const originalStr = originalTree.printTree();
    const duplicateStr = duplicateTree.printTree();
    
    // Print the string representations with truncation for diagnostic purposes
    console.log('Original tree structure (fuzzy test):');
    console.log(originalStr.substring(0, 500) + '...');
    console.log('Duplicate tree structure (fuzzy test):');
    console.log(duplicateStr.substring(0, 500) + '...');
    
    // Now that we've fixed the sorting in printTree, the string representations should be identical
    expect(originalStr).toBe(duplicateStr);
    
    // Additional verification of vertices count
    expect(duplicateTree.getAllVertices().length).toBe(originalTree.getAllVertices().length);
  });
  
  test('trees with different root IDs can never have identical structures', () => {
    // Create two trees with different IDs
    const treeA = new RepTree('treeA');
    const treeB = new RepTree('treeB');
    
    // Create roots for each tree - these will have different IDs
    treeA.createRoot();
    treeB.createRoot();
    
    // Print initial tree state
    console.log('\n===== INITIAL STATE =====');
    printTreeStructure('Tree A', treeA);
    printTreeStructure('Tree B', treeB);
    
    // Add identical operations to each tree
    treeA.root!.name = 'Project';
    treeB.root!.name = 'Project';
    
    treeA.root!.newNamedChild('Docs');
    treeB.root!.newNamedChild('Docs');
    
    // Print trees after operations
    console.log('\n===== AFTER OPERATIONS =====');
    printTreeStructure('Tree A', treeA);
    printTreeStructure('Tree B', treeB);
    
    // Get string representations for comparison
    const treeAString = treeA.printTree();
    const treeBString = treeB.printTree();
    
    console.log('\nTree A string representation:');
    console.log(treeAString);
    console.log('\nTree B string representation:');
    console.log(treeBString);
    
    // Verify trees have different structures due to different root IDs
    // even though they have the same logical structure
    console.log('\nComparing structures:');
    console.log(`Tree A and B match: ${treeA.compareStructure(treeB)}`);
    expect(treeA.compareStructure(treeB)).toBe(false);
    
    // Despite having same logical structure, the string representations
    // will be different because they contain different IDs
    expect(treeAString).not.toBe(treeBString);
    
    // Verify both trees have the same number of vertices
    expect(treeA.getAllVertices().length).toBe(treeB.getAllVertices().length);
    
    // Create a new tree that syncs with both trees
    const mergedTree = new RepTree('merged');
    mergedTree.merge(treeA.getAllOps());
    mergedTree.merge(treeB.getAllOps());
    
    // The merged tree will have both root vertices and their children
    console.log('\n===== MERGED TREE =====');
    printTreeStructure('Merged Tree', mergedTree);
    console.log('\nMerged Tree string representation:');
    console.log(mergedTree.printTree());
    
    // Verify that the merged tree contains more vertices than the individual trees
    // since it has both trees' root vertices and their children
    expect(mergedTree.getAllVertices().length).toBeGreaterThan(treeA.getAllVertices().length);
    
    // Sync trees back with the merged tree
    treeA.merge(mergedTree.getAllOps());
    treeB.merge(mergedTree.getAllOps());
    
    console.log('\n===== FINAL STATE =====');
    printTreeStructure('Tree A after sync', treeA);
    printTreeStructure('Tree B after sync', treeB);
    
    // Final comparison
    console.log('\nFinal comparison:');
    console.log(`Tree A and merged tree match: ${treeA.compareStructure(mergedTree)}`);
    console.log(`Tree B and merged tree match: ${treeB.compareStructure(mergedTree)}`);
    console.log(`Tree A and Tree B match: ${treeA.compareStructure(treeB)}`);
    
    // Get final string representations
    const treeAFinalString = treeA.printTree();
    const treeBFinalString = treeB.printTree();
    const mergedTreeFinalString = mergedTree.printTree();
    
    console.log('\nFinal string comparison:');
    console.log('Tree A:');
    console.log(treeAFinalString);
    console.log('Tree B:');
    console.log(treeBFinalString);
    console.log('Merged Tree:');
    console.log(mergedTreeFinalString);
    
    // Document behavior: Trees with different roots will never have identical structures
    // even after merging operations because their roots remain different
    console.log('\nNOTE: Trees starting with different root IDs will never have identical structures');
    console.log('even after merging all operations, because the root vertices remain distinct.');
    console.log('This is expected behavior for the current implementation.');
    
    // We expect all trees to have the same number of vertices after syncing
    expect(treeA.getAllVertices().length).toBe(treeB.getAllVertices().length);
    expect(treeA.getAllVertices().length).toBe(mergedTree.getAllVertices().length);
    
    // We expect trees with different root IDs to never match in structure
    expect(treeA.compareStructure(treeB)).toBe(false);
  });
}); 