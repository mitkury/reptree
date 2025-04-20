/**
 * MIT License
 * Copyright (c) 2024 Dmitry Kury (d@dkury.com)
 */

import * as Y from 'yjs';

/**
 * Checks if a value is a Y.Doc instance
 * @param value The value to check
 * @returns True if the value is a Y.Doc instance
 */
export function isYDoc(value: any): value is Y.Doc {
  return value instanceof Y.Doc;
}

/**
 * Helper to get a specific shared type from a Y.Doc
 * @param ydoc The Y.Doc instance
 * @param yjsType The type of shared data structure
 * @returns The appropriate shared type (YText, YMap, YArray, or YXmlFragment)
 */
export function getYjsSharedType(ydoc: Y.Doc, yjsType: 'map' | 'array' | 'text' | 'xmlFragment'): Y.AbstractType<any> {
  switch (yjsType) {
    case 'text':
      return ydoc.getText('default');
    case 'map':
      return ydoc.getMap('default');
    case 'array':
      return ydoc.getArray('default');
    case 'xmlFragment':
      return ydoc.getXmlFragment('default');
    default:
      throw new Error(`Unsupported Yjs type: ${yjsType}`);
  }
} 