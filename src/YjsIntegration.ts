/**
 * MIT License
 * Copyright (c) 2024 Dmitry Kury (d@dkury.com)
 */

import * as Y from 'yjs';
import { YjsDocument } from './treeTypes';

// Cache of Yjs document instances by their ID
const yjsDocCache = new Map<string, Y.Doc>();

/**
 * Creates a new Yjs document with the specified type
 * @param yjsType The type of Yjs shared data structure to create
 * @returns A serialized YjsDocument representation
 */
export function createYjsDocument(yjsType: 'map' | 'array' | 'text' | 'xmlFragment'): YjsDocument {
  const ydoc = new Y.Doc();
  
  // Initialize the appropriate shared type
  switch (yjsType) {
    case 'text':
      ydoc.getText('default');
      break;
    case 'map':
      ydoc.getMap('default');
      break;
    case 'array':
      ydoc.getArray('default');
      break;
    case 'xmlFragment':
      ydoc.getXmlFragment('default');
      break;
  }

  // Serialize the document
  const data = Y.encodeStateAsUpdate(ydoc);
  
  return {
    _type: 'yjs',
    yjsType,
    data
  };
}

/**
 * Gets or creates a live Yjs document from a serialized YjsDocument property
 * @param yjsDoc The serialized YjsDocument property
 * @param docId A unique identifier for caching (typically vertexId + propertyKey)
 * @returns A live Y.Doc instance
 */
export function getYjsDocument(yjsDoc: YjsDocument, docId: string): Y.Doc {
  // Check if we have this document in cache
  let ydoc: Y.Doc;
  
  if (yjsDocCache.has(docId)) {
    // Get existing doc and apply updates
    ydoc = yjsDocCache.get(docId)!;
    Y.applyUpdate(ydoc, yjsDoc.data);
  } else {
    // Create a new Yjs document and apply the state
    ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, yjsDoc.data);
    yjsDocCache.set(docId, ydoc);
  }
  
  return ydoc;
}

/**
 * Updates a YjsDocument property with current state
 * @param ydoc The live Y.Doc instance
 * @param yjsType The type of Yjs shared data structure
 * @returns A YjsDocument with the current state
 */
export function updateYjsDocument(ydoc: Y.Doc, yjsType: 'map' | 'array' | 'text' | 'xmlFragment'): YjsDocument {
  // Encode the current state of the document
  const data = Y.encodeStateAsUpdate(ydoc);
  
  return {
    _type: 'yjs',
    yjsType,
    data
  };
}

/**
 * Checks if a value is a YjsDocument
 * @param value The value to check
 * @returns True if the value is a YjsDocument
 */
export function isYjsDocument(value: any): value is YjsDocument {
  return value && typeof value === 'object' && value._type === 'yjs';
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