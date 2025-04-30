import { newMoveVertexOp, type MoveVertex, type SetVertexProperty, isMoveVertexOp, isSetPropertyOp, type VertexOperation, newSetVertexPropertyOp, newSetTransientVertexPropertyOp } from "./operations";
import type { VertexPropertyType, TreeVertexProperty, VertexChangeEvent, TreeVertexId, VertexMoveEvent, OpIdRange } from "./treeTypes"; // Added OpIdRange
import { VertexState } from "./VertexState";
import { TreeState } from "./TreeState";
import { OpId } from "./OpId";
import uuid from "./uuid";
import { Vertex } from './Vertex';

type PropertyKeyAtVertexId = `${string}@${TreeVertexId}`;

/**
 * Helper function to subtract one set of ranges from another.
 * Returns the ranges in A that are not in B.
 * Assumes ranges in both A and B are sorted and non-overlapping.
 */
function subtractRanges(rangesA: number[][], rangesB: number[][]): number[][] {
  if (rangesB.length === 0) return rangesA.map(r => [...r]); // Return a copy
  if (rangesA.length === 0) return []; // If A is empty, nothing to subtract
  
  const result: number[][] = [];
  let indexB = 0;
  
  for (const rangeA of rangesA) {
    let currentStart = rangeA[0];
    const endA = rangeA[1];
    
    // Iterate through ranges in B that could potentially overlap with rangeA
    while (indexB < rangesB.length && rangesB[indexB][1] < currentStart) {
      // Skip ranges in B that are entirely before the current start
      indexB++;
    }

    while (indexB < rangesB.length && rangesB[indexB][0] <= endA) {
      const startB = rangesB[indexB][0];
      const endB = rangesB[indexB][1];

      // If there's a gap before this range in B starts
      if (currentStart < startB) {
        // Add the portion of rangeA before the overlap
        result.push([currentStart, Math.min(endA, startB - 1)]);
      }
      
      // Move current start past this range in B
      currentStart = Math.max(currentStart, endB + 1);
      
      // If we've gone past the end of rangeA, break inner loop
      if (currentStart > endA) break;

      // If the current rangeB ends after rangeA, we don't need to check further ranges in B for this rangeA
      if (endB >= endA) break;

      // Only advance indexB if the current rangeB is fully processed relative to currentStart
      // Advance indexB if the end of the current B range is before the new currentStart
      if (endB < currentStart) { 
         indexB++;
      }
      // If the start of the current B range is greater than or equal to currentStart, 
      // it means this B range has been processed for the current segment of A, so move to the next B range.
      else if (startB >= currentStart) {
          indexB++;
      }
    }
    
    // If there's a remaining part of rangeA after processing overlaps with B
    if (currentStart <= endA) {
      result.push([currentStart, endA]);
    }
  }
  
  return result;
}


/**
 * RepTree is a tree data structure for storing vertices with properties.
 * It uses 2 conflict-free replicated data types (CRDTs) to manage seamless replication between peers.
 * A move tree CRDT is used for the tree structure (https://martin.kleppmann.com/papers/move-op.pdf).
 * A last writer wins (LWW) CRDT is used for properties.
 */
export class RepTree {
  private static NULL_VERTEX_ID = '0';
  private static DEFAULT_MAX_DEPTH = 100000;

  readonly peerId: string;
  readonly rootVertexId: string;

  private lamportClock = 0;
  private state: TreeState;
  private moveOps: MoveVertex[] = [];
  private setPropertyOps: SetVertexProperty[] = [];
  private propertiesAndTheirOpIds: Map<PropertyKeyAtVertexId, OpId> = new Map();
  private transientPropertiesAndTheirOpIds: Map<PropertyKeyAtVertexId, OpId> = new Map();
  private localOps: VertexOperation[] = [];
  private pendingMovesWithMissingParent: Map<string, MoveVertex[]> = new Map();
  private pendingPropertiesWithMissingVertex: Map<string, SetVertexProperty[]> = new Map();
  private appliedOps: Set<string> = new Set();
  private parentIdBeforeMove: Map<OpId, string | null | undefined> = new Map();
  private opAppliedCallbacks: ((op: VertexOperation) => void)[] = [];
  private maxDepth = RepTree.DEFAULT_MAX_DEPTH;

  // State vector tracking operations from each peer
  private stateVector: Record<string, number[][]> = {};

  /**
   * @param peerId - The peer ID of the current client
   * @param ops - The operations to replicate an existing tree, if null - a new tree will be created
   */
  constructor(peerId: string, ops: ReadonlyArray<VertexOperation> | null = null) {
    this.peerId = peerId;
    this.state = new TreeState();

    if (ops != null && ops.length > 0) {
      // Find a move op that has a parentId as null
      let rootMoveOp: MoveVertex | undefined;
      for (let i = 0; i < ops.length; i++) {
        if (isMoveVertexOp(ops[i]) && (ops[i] as MoveVertex).parentId === null) {
          rootMoveOp = ops[i] as MoveVertex;
          break;
        }
      }
      if (rootMoveOp) {
        this.rootVertexId = rootMoveOp.targetId;
      } else {
        throw new Error('The operations has to contain a move operation with a parentId as null to set the root vertex');
      }

      this.applyOps(ops);

      // @TODO: perhaps don't do it here. Handle it in validation.
      this.ensureNullVertex();

      // @TODO: validate the tree structure, throw an exception if it's invalid
    } else {
      // The root is our only vertex that will have a null parentId
      this.rootVertexId = this.newVertexInternalWithUUID(null);

      this.ensureNullVertex();
    }
  }

  getMoveOps(): ReadonlyArray<MoveVertex> {
    return this.moveOps;
  }

  getAllOps(): ReadonlyArray<VertexOperation> {
    return [...this.moveOps, ...this.setPropertyOps];
  }

  getVertex(vertexId: string): Vertex | undefined {
    const vertex = this.state.getVertex(vertexId);
    return vertex ? new Vertex(this, vertex) : undefined;
  }

  get rootVertex(): Vertex {
    const rootVertex = this.state.getVertex(this.rootVertexId);
    if (!rootVertex) {
      throw new Error("Root vertex not found");
    }

    return new Vertex(this, rootVertex);
  }

  getAllVertices(): ReadonlyArray<Vertex> {
    return this.state.getAllVertices().map(v => new Vertex(this, v));
  }

  getParent(vertexId: string): Vertex | undefined {
    const parentId = this.state.getVertex(vertexId)?.parentId;
    const parent = parentId ? this.state.getVertex(parentId) : undefined;
    return parent ? new Vertex(this, parent) : undefined;
  }

  getChildren(vertexId: string): Vertex[] {
    return this.state.getChildren(vertexId).map(v => new Vertex(this, v));
  }

  getChildrenIds(vertexId: string): string[] {
    return this.state.getChildrenIds(vertexId);
  }

  getAncestors(vertexId: string): Vertex[] {
    const ancestors: Vertex[] = [];
    let currentVertex = this.state.getVertex(vertexId);

    while (currentVertex && currentVertex.parentId) {
      const parentVertex = this.state.getVertex(currentVertex.parentId);
      if (parentVertex) {
        ancestors.push(new Vertex(this, parentVertex));
        currentVertex = parentVertex;
      } else {
        break;
      }
    }

    return ancestors;
  }

  getVertexProperty(vertexId: string, key: string, includingTransient: boolean = true): VertexPropertyType | undefined {
    const vertex = this.state.getVertex(vertexId);
    if (!vertex) {
      return undefined;
    }

    return vertex.getProperty(key, includingTransient);
  }

  getVertexProperties(vertexId: string): Readonly<TreeVertexProperty[]> {
    const vertex = this.state.getVertex(vertexId);
    if (!vertex) {
      return [];
    }

    return vertex.getAllProperties();
  }

  popLocalOps(): VertexOperation[] {
    const ops = this.localOps;
    this.localOps = [];
    return ops;
  }

  setMaxDepth(maxDepth: number) {
    this.maxDepth = maxDepth;
  }

  newVertex(parentId: string, props: Record<string, VertexPropertyType> | object | null = null): Vertex {
    const typedProps = props as Record<string, VertexPropertyType> | null;
    const vertexId = this.newVertexInternalWithUUID(parentId);
    if (typedProps) {
      this.setVertexProperties(vertexId, typedProps);
    }

    const vertex = this.state.getVertex(vertexId);
    if (!vertex) {
      throw new Error('Failed to create vertex');
    }
    return new Vertex(this, vertex);
  }

  newNamedVertex(parentId: string, name: string, props: Record<string, VertexPropertyType> | object | null = null): Vertex {
    const typedProps = props as Record<string, VertexPropertyType> | null;
    const vertexId = this.newVertexInternalWithUUID(parentId);
    if (typedProps) {
      this.setVertexProperties(vertexId, typedProps);
    }
    this.setVertexProperty(vertexId, '_n', name);

    const vertex = this.state.getVertex(vertexId);
    if (!vertex) {
      throw new Error('Failed to create named vertex');
    }
    return new Vertex(this, vertex);
  }

  moveVertex(vertexId: string, parentId: string) {
    this.lamportClock++;
    const op = newMoveVertexOp(this.lamportClock, this.peerId, vertexId, parentId);
    this.localOps.push(op);
    this.applyMove(op);
  }

  deleteVertex(vertexId: string) {
    this.moveVertex(vertexId, RepTree.NULL_VERTEX_ID);
  }

  setTransientVertexProperty(vertexId: string, key: string, value: VertexPropertyType) {
    this.lamportClock++;
    const op = newSetTransientVertexPropertyOp(this.lamportClock, this.peerId, vertexId, key, value);
    this.localOps.push(op);
    this.applyProperty(op);
  }

  setVertexProperty(vertexId: string, key: string, value: VertexPropertyType) {
    this.lamportClock++;
    const op = newSetVertexPropertyOp(this.lamportClock, this.peerId, vertexId, key, value);
    this.localOps.push(op);
    this.applyProperty(op);
  }

  setVertexProperties(vertexId: string, props: Record<string, VertexPropertyType> | object) {
    const typedProps = props as Record<string, VertexPropertyType>;
    for (const [key, value] of Object.entries(typedProps)) {
      this.setVertexProperty(vertexId, key, value);
    }
  }

  getVertexByPath(path: string): Vertex | undefined {
    // Let's remove '/' at the start and at the end of the path
    path = path.replace(/^\/+/, '');
    path = path.replace(/\/+$/, '');

    const pathParts = path.split('/');

    const root = this.state.getVertex(this.rootVertexId);
    if (!root) {
      throw new Error('The root vertex is not found');
    }

    const vertex = this.getVertexByPathArray(new Vertex(this, root), pathParts);
    return vertex;
  }

  private getVertexByPathArray(vertex: Vertex, path: string[]): Vertex | undefined {
    if (path.length === 0) {
      return vertex ?? undefined;
    }

    const targetName = path[0];
    // Now, search recursively by name '_n' in children until the path is empty or not found.
    const children = this.getChildren(vertex.id);
    for (const child of children) {
      if (child.getProperty('_n') === targetName) {
        return this.getVertexByPathArray(child, path.slice(1));
      }
    }

    return undefined;
  }

  printTree() {
    return this.state.printTree(this.rootVertexId);
  }

  merge(ops: ReadonlyArray<VertexOperation>) {
    /*
    if (ops.length > 100) {
      this.applyOpsOptimizedForLotsOfMoves(ops);
    } else {
      this.applyOps(ops);
    }
    */

    this.applyOps(ops);
  }

  /** Applies operations in an optimized way, sorting move ops by OpId to avoid undo-do-redo cycles */
  private applyOpsOptimizedForLotsOfMoves(ops: ReadonlyArray<VertexOperation>) {
    const newMoveOps = ops.filter(op => isMoveVertexOp(op) && !this.appliedOps.has(op.id.toString()));
    if (newMoveOps.length > 0) {
      // Get an array of all move ops (without already applied ones)
      const allMoveOps = [...this.moveOps, ...newMoveOps] as MoveVertex[];
      // The main point of this optimization is to apply the moves without undo-do-redo cycles (the conflict resolution algorithm).
      // That is why we sort by OpId.
      allMoveOps.sort((a, b) => OpId.compare(a.id, b.id));
      for (let i = 0, len = allMoveOps.length; i < len; i++) {
        const op = allMoveOps[i];
        this.applyMove(op);
      }
    }

    // Get an array of all property ops (without already applied ones)
    const propertyOps = ops.filter(op => isSetPropertyOp(op) && !this.appliedOps.has(op.id.toString())) as SetVertexProperty[];
    for (let i = 0, len = propertyOps.length; i < len; i++) {
      const op = propertyOps[i];
      this.applyProperty(op);
    }
  }

  compareStructure(other: RepTree): boolean {
    return RepTree.compareVertices(this.rootVertexId, this, other);
  }

  compareMoveOps(other: RepTree): boolean {
    const movesA = this.moveOps;
    const movesB = other.getMoveOps();

    if (movesA.length !== movesB.length) {
      return false;
    }

    for (let i = 0; i < movesA.length; i++) {
      if (!OpId.equals(movesA[i].id, movesB[i].id)) {
        return false;
      }
    }

    return true;
  }

  /** Checks if the given `ancestorId` is an ancestor of `childId` in the tree */
  isAncestor(childId: string, ancestorId: string | null): boolean {
    let targetId = childId;
    let vertex: VertexState | undefined;
    let depth = 0;

    while (vertex = this.state.getVertex(targetId)) {
      if (vertex.parentId === ancestorId) return true;
      if (!vertex.parentId) return false;

      if (depth > this.maxDepth) {
        console.error(`isAncestor: max depth of ${this.maxDepth} reached. Perhaps, we have an infinite loop here.`);
        return true;
      }

      targetId = vertex.parentId;
      depth++;
    }

    return false;
  }

  observeVertex(vertexId: string, callback: (updatedVertex: Vertex) => void): () => void {
    const vertex = this.getVertex(vertexId);
    if (vertex) {
      callback(vertex);
    }

    const unsubscribe = this.observe(vertexId, (_) => { 
      const vertex = this.getVertex(vertexId);
      if (vertex) {
        callback(vertex);
      }
    });

    return () => {
      unsubscribe();
    };
  }

  observeVertexMove(callback: (movedVertex: Vertex, isNew: boolean) => void): () => void {
    const listener = (events: VertexChangeEvent[]) => {
      const moveEvent = events.find(e => e.type === 'move') as VertexMoveEvent | undefined;
      if (moveEvent) {
        const vertex = this.getVertex(moveEvent.vertexId);
        if (vertex) {
          callback(vertex, moveEvent.oldParentId === undefined);
        }
      }
    };

    this.state.addGlobalChangeCallback(listener);

    return () => this.state.removeGlobalChangeCallback(listener);
  }

  observe(vertexId: string, callback: (events: VertexChangeEvent[]) => void): () => void {
    this.state.addChangeCallback(vertexId, callback);
    return () => this.state.removeChangeCallback(vertexId, callback);
  }

  observeOpApplied(callback: (op: VertexOperation) => void): () => void {
    this.opAppliedCallbacks.push(callback);
    return () => this.opAppliedCallbacks = this.opAppliedCallbacks.filter(l => l !== callback);
  }

  static compareVertices(vertexId: string, treeA: RepTree, treeB: RepTree): boolean {
    const childrenA = treeA.state.getChildrenIds(vertexId);
    const childrenB = treeB.state.getChildrenIds(vertexId);

    if (childrenA.length !== childrenB.length) {
      return false;
    }

    // Compare properties of the current vertex
    if (vertexId !== null) {
      const propertiesA = treeA.getVertexProperties(vertexId);
      const propertiesB = treeB.getVertexProperties(vertexId);

      if (propertiesA.length !== propertiesB.length) {
        return false;
      }

      for (const propA of propertiesA) {
        const propB = propertiesB.find(p => p.key === propA.key);
        if (!propB || propA.value !== propB.value) {
          return false;
        }
      }
    }

    // Compare children and their properties recursively
    for (const childId of childrenA) {
      if (!childrenB.includes(childId)) {
        return false;
      }

      if (!RepTree.compareVertices(childId, treeA, treeB)) {
        return false;
      }
    }

    return true;
  }

  private newVertexInternal(vertexId: string, parentId: string | null): string {
    this.lamportClock++;
    // To create a vertex - we move a vertex with a fresh id under the parent.
    // No need to have a separate "create vertex" operation.
    const op = newMoveVertexOp(this.lamportClock, this.peerId, vertexId, parentId);
    this.localOps.push(op);
    this.applyMove(op);

    // Set the creation date
    this.setVertexProperty(vertexId, '_c', new Date().toISOString());

    return vertexId;
  }

  private newVertexInternalWithUUID(parentId: string | null): string {
    const vertexId = uuid();
    return this.newVertexInternal(vertexId, parentId);
  }

  private ensureNullVertex() {
    const vertexId = RepTree.NULL_VERTEX_ID;

    // Check if the null vertex already exists
    if (this.state.getVertex(vertexId)) {
      return;
    }

    this.newVertexInternal(vertexId, null);
  }

  /** Updates the lamport clock with the counter value of the operation */
  private updateLamportClock(operation: VertexOperation): void {
    // This is how Lamport clock updates with a foreign operation that has a greater counter value.
    if (operation.id.counter > this.lamportClock) {
      this.lamportClock = operation.id.counter;
    }
  }

  private applyPendingMovesForParent(parentId: string) {
    // If a parent doesn't exist, we can't apply pending moves yet.
    if (!this.state.getVertex(parentId)) {
      return;
    }

    const pendingMoves = this.pendingMovesWithMissingParent.get(parentId);
    if (!pendingMoves) {
      return;
    }

    this.pendingMovesWithMissingParent.delete(parentId);

    for (const pendingOp of pendingMoves) {
      this.applyMove(pendingOp);
    }
  }

  private applyMove(op: MoveVertex) {
    // Check if a parent (unless we're dealing with the root vertex) exists for the move operation.
    // If it doesn't exist, stash the move op for later
    if (op.parentId !== null && !this.state.getVertex(op.parentId)) {
      if (!this.pendingMovesWithMissingParent.has(op.parentId)) {
        this.pendingMovesWithMissingParent.set(op.parentId, []);
      }
      this.pendingMovesWithMissingParent.get(op.parentId)!.push(op);
      return;
    }

    this.updateLamportClock(op);

    const lastOp = this.moveOps.length > 0 ? this.moveOps[this.moveOps.length - 1] : null;

    // If it's the most recent move operation - just try to move it. No conflict resolution is needed.
    if (lastOp === null || op.id.isGreaterThan(lastOp.id)) {
      this.moveOps.push(op);
      this.reportOpAsApplied(op);
      this.tryToMove(op);
    }

    // Here comes the core of the 'THE REPLICATED TREE ALGORITHM'.
    // From https://martin.kleppmann.com/papers/move-op.pdf
    // We undo all moves that are newer (based on the Lamport clock) than the target move, do the move, and then redo the moves we just undid.
    // The algorithm ensures that all replicas converge to the same tree after applying all operations.
    // The replicas are basically forced to apply the moves in the same order (by undo-do-redo).
    // So if a conflict or a cycle is introduced by some of the peers - the algorithm will resolve it.
    // tryToMove function has the logic to detect cycles and will ignore the move if it creates a cycle. 
    else {
      let targetIndex = this.moveOps.length;
      for (let i = this.moveOps.length - 1; i >= 0; i--) {
        const moveOp = this.moveOps[i];
        targetIndex = i;
        if (op.id.isGreaterThan(moveOp.id)) {
          break;
        }
        else {
          this.undoMove(moveOp);
        }
      }

      // Insert the op at the correct position
      this.moveOps.splice(targetIndex + 1, 0, op);
      this.reportOpAsApplied(op);
      this.tryToMove(op);

      // Redo all of the operations after the operation that we applied
      for (let i = targetIndex + 2; i < this.moveOps.length; i++) {
        this.tryToMove(this.moveOps[i]);
      }
    }

    // After applying the move, check if it unblocks any pending moves
    // We use targetId here because this vertex might now be a parent for pending operations
    this.applyPendingMovesForParent(op.targetId);
  }

  private setPropertyAndItsOpId(op: SetVertexProperty) {
    this.propertiesAndTheirOpIds.set(`${op.key}@${op.targetId}`, op.id);
    this.state.setProperty(op.targetId, op.key, op.value);
    this.reportOpAsApplied(op);
  }

  private setTransientPropertyAndItsOpId(op: SetVertexProperty) {
    this.transientPropertiesAndTheirOpIds.set(`${op.key}@${op.targetId}`, op.id);
    this.state.setTransientProperty(op.targetId, op.key, op.value);
    this.reportOpAsApplied(op);
  }

  private applyProperty(op: SetVertexProperty) {
    const targetVertex = this.state.getVertex(op.targetId);
    if (!targetVertex) {
      // No need to handle transient properties if the vertex doesn't exist
      if (op.transient) {
        return;
      }

      // If the vertex doesn't exist, we will wait for the move operation to appear that will create the vertex
      // so we can apply the property then.
      if (!this.pendingPropertiesWithMissingVertex.has(op.targetId)) {
        this.pendingPropertiesWithMissingVertex.set(op.targetId, []);
      }
      this.pendingPropertiesWithMissingVertex.get(op.targetId)!.push(op);
      return;
    }

    this.updateLamportClock(op);

    const prevTransientOpId = this.transientPropertiesAndTheirOpIds.get(`${op.key}@${op.targetId}`);

    const prevProp = targetVertex.getProperty(op.key);
    const prevOpId = this.propertiesAndTheirOpIds.get(`${op.key}@${op.targetId}`);

    if (!op.transient) {
      this.setPropertyOps.push(op);

      // Apply the property if it's not already applied or if the current op is newer
      // This is the last writer wins approach that ensures the same state between replicas.
      if (!prevProp || !prevOpId || op.id.isGreaterThan(prevOpId)) {
        this.setPropertyAndItsOpId(op);
      }

      // Remove the transient property if the current op is greater
      if (prevTransientOpId && op.id.isGreaterThan(prevTransientOpId)) {
        this.transientPropertiesAndTheirOpIds.delete(`${op.key}@${op.targetId}`);
        targetVertex.removeTransientProperty(op.key);
      }
    } else {
      if (!prevTransientOpId || op.id.isGreaterThan(prevTransientOpId)) {
        this.setTransientPropertyAndItsOpId(op);
      }
    }
  }

  private applyOps(ops: ReadonlyArray<VertexOperation>) {
    for (const op of ops) {
      if (this.appliedOps.has(op.id.toString())) {
        continue;
      }

      if (isMoveVertexOp(op)) {
        this.applyMove(op);
      } else if (isSetPropertyOp(op)) {
        this.applyProperty(op);
      }
    }
  }

  private reportOpAsApplied(op: VertexOperation) {
    this.appliedOps.add(op.id.toString());
    this.updateStateVector(op); // Call the method correctly
    for (const callback of this.opAppliedCallbacks) {
      callback(op);
    }
  }

  private tryToMove(op: MoveVertex) {
    let targetVertex = this.state.getVertex(op.targetId);

    if (targetVertex) {
      // We cache the parentId before the move operation.
      // We will use it to undo the move according to the move op algorithm.
      this.parentIdBeforeMove.set(op.id, targetVertex.parentId);
    }

    // If trying to move the target vertex under itself - do nothing
    if (op.targetId === op.parentId) return;

    // If we try to move the vertex (op.targetId) under one of its descendants (op.parentId) - do nothing
    if (op.parentId && this.isAncestor(op.parentId, op.targetId)) return;

    this.state.moveVertex(op.targetId, op.parentId);

    // If the vertex didn't exist before the move - see if it has pending properties
    // and apply them.
    if (!targetVertex) {
      const pendingProperties = this.pendingPropertiesWithMissingVertex.get(op.targetId) || [];
      this.pendingPropertiesWithMissingVertex.delete(op.targetId);
      for (const prop of pendingProperties) {
        this.setPropertyAndItsOpId(prop);
      }
    }
  }

  private undoMove(op: MoveVertex) {
    const targetVertex = this.state.getVertex(op.targetId);
    if (!targetVertex) {
      console.error(`An attempt to undo move operation ${op.id.toString()} failed because the target vertex ${op.targetId} not found`);
      return;
    }

    const prevParentId = this.parentIdBeforeMove.get(op.id);
    if (prevParentId === undefined) {
      return;
    }

    this.state.moveVertex(op.targetId, prevParentId);
  }

  // --- Range-Based State Vector Methods --- 

  /**
   * Updates the state vector with a newly applied operation.
   * Assumes ranges are sorted and non-overlapping.
   * 
   * @param op The operation that was just applied
   */
  private updateStateVector(op: VertexOperation): void {
    const peerId = op.id.peerId;
    const counter = op.id.counter;
    
    // Initialize ranges array for this peer if it doesn't exist
    if (!this.stateVector[peerId]) {
      this.stateVector[peerId] = [];
    }
    
    const ranges = this.stateVector[peerId];
    
    // Case 1: No ranges yet
    if (ranges.length === 0) {
      ranges.push([counter, counter]);
      return;
    }
    
    let rangeExtendedOrMerged = false;
    let insertIndex = -1;

    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      
      // If counter is already in a range, do nothing
      if (counter >= range[0] && counter <= range[1]) {
        rangeExtendedOrMerged = true;
        break;
      }
      
      // If counter is one less than range start, extend range start
      if (counter === range[0] - 1) {
        range[0] = counter;
        rangeExtendedOrMerged = true;
        // Check if this range now merges with the previous range
        if (i > 0 && range[0] === ranges[i - 1][1] + 1) {
          ranges[i - 1][1] = range[1]; // Merge into previous
          ranges.splice(i, 1); // Remove current
        }
        break;
      }
      
      // If counter is one more than range end, extend range end
      if (counter === range[1] + 1) {
        range[1] = counter;
        rangeExtendedOrMerged = true;
        // Check if this range now merges with the next range
        if (i < ranges.length - 1 && range[1] + 1 === ranges[i + 1][0]) {
          range[1] = ranges[i + 1][1]; // Merge next into current
          ranges.splice(i + 1, 1); // Remove next
        }
        break;
      }

      // Keep track of where to insert if no extension/merge happens
      if (counter < range[0] && insertIndex === -1) {
          insertIndex = i;
      }
    }
    
    // If we couldn't extend or merge any range, add a new one
    if (!rangeExtendedOrMerged) {
      if (insertIndex === -1) {
        // If counter is greater than all existing ranges, add to the end
        insertIndex = ranges.length;
      }
      ranges.splice(insertIndex, 0, [counter, counter]);
      // After inserting, check if the new range merges with neighbors
      // Merge with previous range if possible
      if (insertIndex > 0 && ranges[insertIndex][0] === ranges[insertIndex - 1][1] + 1) {
        ranges[insertIndex - 1][1] = ranges[insertIndex][1];
        ranges.splice(insertIndex, 1);
        insertIndex--; // Adjust index after merging
      }
      // Merge with next range if possible (use adjusted insertIndex)
      if (insertIndex < ranges.length - 1 && ranges[insertIndex][1] + 1 === ranges[insertIndex + 1][0]) {
        ranges[insertIndex][1] = ranges[insertIndex + 1][1];
        ranges.splice(insertIndex + 1, 1);
      }
    }
  }

  /**
   * Returns the current state vector.
   * Returns a readonly reference to the internal state vector.
   */
  getStateVector(): Readonly<Record<string, number[][]>> {
    return this.stateVector;
  }

  /**
   * Calculates which operation ranges we have that the other peer is missing
   * by comparing state vectors.
   * 
   * @param theirStateVector The state vector from another peer
   * @returns Array of operation ID ranges that we have but they don't
   */
  private diffStateVectors(theirStateVector: Record<string, number[][]>): OpIdRange[] {
    const missingRanges: OpIdRange[] = [];
    
    // Check what we have that they don't have
    for (const [peerId, ourRanges] of Object.entries(this.stateVector)) {
      const theirRanges = theirStateVector[peerId] || [];
      
      // Calculate ranges we have that they don't
      const missing = subtractRanges(ourRanges, theirRanges);
      
      // Convert to OpIdRange format
      for (const [start, end] of missing) {
        // Ensure the range is valid (start <= end)
        if (start <= end) {
           missingRanges.push({
             peerId,
             start,
             end
           });
        }
      }
    }
    
    return missingRanges;
  }

  /**
   * Determines which operations are needed to synchronize 
   * with the provided state vector.
   * 
   * @param theirStateVector The state vector from another peer
   * @returns Operations that should be sent to the other peer, sorted by OpId.
   */
  getMissingOps(theirStateVector: Record<string, number[][]>): VertexOperation[] {
    // First, identify the missing operation ranges by comparing state vectors
    const missingRanges = this.diffStateVectors(theirStateVector);
    
    // Then, retrieve only the operations that fall within those ranges
    const missingOps: VertexOperation[] = [];
    // Combine moveOps and setPropertyOps for checking
    const allOps = [...this.moveOps, ...this.setPropertyOps]; 
    
    // Only check operations that might be in the missing ranges
    for (const op of allOps) {
      for (const range of missingRanges) {
        if (op.id.peerId === range.peerId && 
            op.id.counter >= range.start && 
            op.id.counter <= range.end) {
          missingOps.push(op);
          break; // Move to the next op once found in a missing range
        }
      }
    }
    
    // Sort the missing ops by OpId before returning, ensuring causal order
    missingOps.sort((a, b) => OpId.compare(a.id, b.id));

    return missingOps;
  }
}

