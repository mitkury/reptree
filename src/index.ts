// Main class
export { RepTree } from './RepTree';

// Core types and classes
export { Vertex } from './Vertex';
export { VertexState } from './VertexState';
export { TreeState } from './TreeState';
export { OpId } from './OpId';
export { StateVector } from './StateVector';

// Types
export * from './treeTypes';
export * from './operations';

// Utilities
export { default as uuid } from './utils/uuid';

// Reactive helpers (opt-in)
export { bindVertex } from './reactive';
export type { BindedVertex, SchemaLike, BindOptions } from './reactive';