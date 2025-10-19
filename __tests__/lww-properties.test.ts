import { RepTree } from '../src';
import { describe, test, expect } from 'vitest';

describe('LWW Properties', () => {
  function testPropertyType(propertyName: string, values: any[], expectedFinalValue: any) {
    // Create a tree and get the root vertex
    const tree = new RepTree('peer1');
    const root = tree.createRoot();

    // Set properties in order
    for (const value of values) {
      root.setProperty(propertyName, value);
    }

    // Verify final value
    expect(root.getProperty(propertyName)).toBe(expectedFinalValue);

    // Test with operations in reverse order
    const reversedOps = [...tree.getAllOps()].reverse();
    const duplicateTree = new RepTree('peer2', reversedOps);
    
    const rootFromDuplicateTree = duplicateTree.root;
    expect(rootFromDuplicateTree).not.toBeUndefined();
    
    if (rootFromDuplicateTree) {
      expect(rootFromDuplicateTree.getProperty(propertyName)).toBe(expectedFinalValue);
    }
  }

  test('should handle boolean properties with LWW semantics', () => {
    testPropertyType('active', [true, false, true, false], false);
  });

  test('should handle number properties with LWW semantics', () => {
    testPropertyType('count', [1, 2, 3, 4, 5], 5);
  });

  test('should handle string properties with LWW semantics', () => {
    testPropertyType('name', ['one', 'two', 'three', 'four'], 'four');
  });

  test('should handle array properties with LWW semantics', () => {
    testPropertyType('tags', [[], ['a'], ['a','b'], ['x','y','z']], ['x','y','z']);
  });

  test('should handle object properties with LWW semantics', () => {
    testPropertyType('meta', [{}, {a:1}, {a:1,b:2}, {nested:{x:1}}], {nested:{x:1}});
  });
});
