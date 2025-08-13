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
export { default as uuid } from './uuid';

// Reactive helpers (opt-in)
export { bindVertex } from './reactive';

// Storage interfaces and default adapters
export type { EncodedVertex, VertexStore, LogStoreLike, MoveLogStore, PropLogStore } from './storage/types';
export { MemoryVertexStore, MemoryLogStore } from './storage/memory';
export { SqliteVertexStore, SqliteJsonLogStore, ensureRepTreeSchema } from './storage/sqlite';