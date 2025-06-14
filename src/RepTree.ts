import {
  newMoveVertexOp,
  type MoveVertex,
  type SetVertexProperty,
  isMoveVertexOp,
  isModifyPropertyOp,
  type VertexOperation,
  newSetVertexPropertyOp,
  newSetTransientVertexPropertyOp,
  isAnyPropertyOp
} from "./operations";
import type { VertexPropertyType, VertexPropertyTypeInOperation, CRDTType, TreeVertexProperty, VertexChangeEvent, TreeVertexId, VertexMoveEvent } from "./treeTypes";
import { VertexState } from "./VertexState";
import { TreeState } from "./TreeState";
import { type OpId, compareOpId, equalsOpId, isOpIdGreaterThan, opIdToString } from "./OpId";
import uuid from "./uuid";
import { Vertex } from './Vertex';
import { StateVector } from './StateVector';
import * as Y from 'yjs';

type PropertyKeyAtVertexId = `${string}@${TreeVertexId}`;

/**
 * RepTree is a tree data structure for storing vertices with properties.
 * It uses 2 conflict-free replicated data types (CRDTs) to manage seamless replication between peers.
 * A move tree CRDT is used for the tree structure (https://martin.kleppmann.com/papers/move-op.pdf).
 * A last writer wins (LWW) CRDT is used for properties.
 */
export class RepTree {
  private static NULL_VERTEX_ID = '0';

  readonly peerId: string;
  private rootVertexId: string | undefined;

  private lamportClock = 0;
  private state: TreeState;
  private moveOps: MoveVertex[] = [];
  private setPropertyOps: SetVertexProperty[] = [];
  private propertiesAndTheirOpIds: Map<PropertyKeyAtVertexId, OpId> = new Map();
  private transientPropertiesAndTheirOpIds: Map<PropertyKeyAtVertexId, OpId> = new Map();
  private yjsObservers: Map<PropertyKeyAtVertexId, (update: Uint8Array, origin: any, doc: Y.Doc, transaction: Y.Transaction) => void> = new Map();
  private localOps: VertexOperation[] = [];
  private pendingMovesWithMissingParent: Map<string, MoveVertex[]> = new Map();
  private pendingPropertiesWithMissingVertex: Map<string, SetVertexProperty[]> = new Map();
  private knownOps: Set<string> = new Set();
  private parentIdBeforeMove: Map<OpId, string | null | undefined> = new Map();
  private opAppliedCallbacks: ((op: VertexOperation) => void)[] = [];

  // State vector tracking operations from each peer
  private stateVector: StateVector;
  private _stateVectorEnabled: boolean = true;

  /**
   * @param peerId - The peer ID of the current client. Should be unique across all peers.
   * @param ops - The operations to replicate an existing tree, if not provided - an empty tree will be created without a root vertex
   */
  constructor(peerId: string, ops?: ReadonlyArray<VertexOperation>) {
    this.peerId = peerId;
    this.state = new TreeState();

    // Initialize state vector (enabled by default)
    this.stateVector = new StateVector();

    if (ops && ops.length > 0) {
      this.applyOps(ops);

      const root = this.root;
      if (!root) {
        throw new Error('There has to be a root vertex in the operations');
      }

      // @TODO: validate the tree structure, throw an exception if it's invalid
    }
    // @TODO: remove it? It creates an extra null vertex op in every new empty tree. Or is it ok?
    else {
      this.ensureNullVertex();
    }
  }

  get root(): Vertex | undefined {
    if (!this.rootVertexId) {
      const vertices = this.state.getAllVertices();
      for (const vertex of vertices) {
        if (vertex.parentId === null && vertex.id !== RepTree.NULL_VERTEX_ID) {
          this.rootVertexId = vertex.id;
          return new Vertex(this, vertex);
        }
      }

      return undefined;
    }

    const rootVertex = this.state.getVertex(this.rootVertexId);
    if (!rootVertex) {
      throw new Error("Root vertex not found");
    }

    return new Vertex(this, rootVertex);
  }

  replicate(newPeerId: string): RepTree {
    return new RepTree(newPeerId, this.getAllOps());
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

  /**
   * Returns all local operations and clears the local operations list.
   * Can be used to get all operations that were generated from this peer and need to be sent to other peers.
   */
  popLocalOps(): VertexOperation[] {
    const ops = this.localOps;
    this.localOps = [];
    return ops;
  }

  createRoot(): Vertex {
    if (this.rootVertexId) {
      throw new Error('Root vertex already exists');
    }

    this.rootVertexId = this.newVertexInternalWithUUID(null);

    const rootVertex = this.state.getVertex(this.rootVertexId);
    if (!rootVertex) {
      throw new Error("Root vertex not found");
    }

    return new Vertex(this, rootVertex);
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

    // Convert Y.Doc to CRDTType for operation
    let opValue: VertexPropertyTypeInOperation;
    if (value instanceof Y.Doc) {
      const state = Y.encodeStateAsUpdate(value);
      opValue = {
        type: "yjs",
        value: state
      };

      // Set up observer for future changes
      this.setupYjsObserver(value, vertexId, key);
    } else {
      // Regular values pass through unchanged
      opValue = value as VertexPropertyTypeInOperation;
    }

    const op = newSetTransientVertexPropertyOp(this.lamportClock, this.peerId, vertexId, key, opValue);
    this.localOps.push(op);
    this.applyProperty(op);
  }

  setVertexProperty(vertexId: string, key: string, value: VertexPropertyType) {
    this.lamportClock++;

    // Convert Y.Doc to CRDTType for operation
    let opValue: VertexPropertyTypeInOperation;
    if (value instanceof Y.Doc) {
      const state = Y.encodeStateAsUpdate(value);
      opValue = {
        type: "yjs",
        value: state
      };

      // Set up observer for future changes
      this.setupYjsObserver(value, vertexId, key);
    } else {
      // Regular values pass through unchanged
      opValue = value as VertexPropertyTypeInOperation;
    }

    const op = newSetVertexPropertyOp(this.lamportClock, this.peerId, vertexId, key, opValue);
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

    if (!this.rootVertexId) {
      return undefined;
    }

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
    if (!this.rootVertexId) {
      return '';
    }

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

  private applyOps(ops: ReadonlyArray<VertexOperation>) {
    for (const op of ops) {
      // We skip the operation if we already know about it.
      // This is to avoid processing the same operation multiple times.
      if (this.knownOps.has(opIdToString(op.id))) {
        continue;
      }

      this.applyOperation(op);
    }
  }

  /** Applies operations in an optimized way, sorting move ops by OpId to avoid undo-do-redo cycles */
  private applyOpsOptimizedForLotsOfMoves(ops: ReadonlyArray<VertexOperation>) {
    const newMoveOps = ops.filter(op => isMoveVertexOp(op) && !this.knownOps.has(opIdToString(op.id)));
    if (newMoveOps.length > 0) {
      // Get an array of all move ops (without already applied ones)
      const allMoveOps = [...this.moveOps, ...newMoveOps] as MoveVertex[];
      // The main point of this optimization is to apply the moves without undo-do-redo cycles (the conflict resolution algorithm).
      // That is why we sort by OpId.
      allMoveOps.sort((a, b) => compareOpId(a.id, b.id));
      for (let i = 0, len = allMoveOps.length; i < len; i++) {
        const op = allMoveOps[i];
        this.applyMove(op);
      }
    }

    // Get an array of all property ops (without already applied ones)
    const propertyOps = ops.filter(op => isAnyPropertyOp(op) && !this.knownOps.has(opIdToString(op.id)));
    for (let i = 0, len = propertyOps.length; i < len; i++) {
      const op = propertyOps[i];
      this.applyProperty(op as SetVertexProperty);
    }
  }

  compareStructure(other: RepTree): boolean {
    if (this.root?.id !== other.root?.id) {
      return false;
    }

    if (!this.rootVertexId) {
      return true;
    }

    return RepTree.compareVertices(this.rootVertexId, this, other);
  }

  compareMoveOps(other: RepTree): boolean {
    const movesA = this.moveOps;
    const movesB = other.getMoveOps();

    if (movesA.length !== movesB.length) {
      return false;
    }

    for (let i = 0; i < movesA.length; i++) {
      if (!equalsOpId(movesA[i].id, movesB[i].id)) {
        return false;
      }
    }

    return true;
  }

  /** Checks if the given `ancestorId` is an ancestor of `childId` in the tree */
  isAncestor(childId: string, ancestorId: string | null): boolean {
    let targetId = childId;
    let vertex: VertexState | undefined;
    
    // Set to track visited vertices and detect cycles
    const visitedVertices = new Set<string>();

    while (vertex = this.state.getVertex(targetId)) {
      if (vertex.parentId === ancestorId) return true;
      if (!vertex.parentId) return false;
      
      // If we've already visited this vertex, we have a cycle
      if (visitedVertices.has(targetId)) {
        console.error(`isAncestor: cycle detected in the tree structure.`);
        // In the context of tryToMove, we should return false here to prevent the move
        // since the target ancestor isn't actually in the path (we're in a cycle)
        return false;
      }
      
      // Mark this vertex as visited
      visitedVertices.add(targetId);
      
      targetId = vertex.parentId;
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
        if (!propB) {
          return false;
        }
      
        // Special handling for Yjs documents
        if (propA.value instanceof Y.Doc && propB.value instanceof Y.Doc) {
          // Create snapshots of the Yjs documents
          const snapshotA = Y.snapshot(propA.value);
          const snapshotB = Y.snapshot(propB.value);
          
          // Compare the snapshots using Y.equalSnapshots
          // This properly compares the document structure and content
          if (!Y.equalSnapshots(snapshotA, snapshotB)) {
            return false;
          }
        } else if (propA.value !== propB.value) {
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
    if (lastOp === null || isOpIdGreaterThan(op.id, lastOp.id)) {
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
        if (isOpIdGreaterThan(op.id, moveOp.id)) {
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

  private setLLWPropertyAndItsOpId(op: SetVertexProperty) {
    this.propertiesAndTheirOpIds.set(`${op.key}@${op.targetId}`, op.id);
    this.state.setProperty(op.targetId, op.key, op.value);
    this.reportOpAsApplied(op);
  }

  private setTransientPropertyAndItsOpId(op: SetVertexProperty) {
    this.transientPropertiesAndTheirOpIds.set(`${op.key}@${op.targetId}`, op.id);
    this.state.setTransientProperty(op.targetId, op.key, op.value);
    this.reportOpAsApplied(op);
  }

  private setupYjsObserver(doc: Y.Doc, vertexId: string, key: string) {
    // Create a unique key for this property
    const propertyKey = `${key}@${vertexId}` as PropertyKeyAtVertexId;

    // Remove any existing observer
    if (this.yjsObservers.has(propertyKey)) {
      const existingDoc = this.getVertexProperty(vertexId, key);
      if (existingDoc instanceof Y.Doc) {
        existingDoc.off('update', this.yjsObservers.get(propertyKey)!);
      }
      this.yjsObservers.delete(propertyKey);
    }

    // Create and store the new observer
    const ydocObserver = (update: Uint8Array, origin: any, doc: Y.Doc, transaction: Y.Transaction) => {      
      if (!transaction.local) {
        return;
      }

      // We create ops when the doc changes.
      // Only from the same peer

      const crdtValue: CRDTType = {
        type: "yjs",
        value: update
      };

      this.lamportClock++;

      // Create a SetVertexProperty operation with the CRDTType
      const op = newSetVertexPropertyOp(
        this.lamportClock,
        this.peerId,
        vertexId,
        key,
        crdtValue
      );

      this.localOps.push(op);
      this.applyProperty(op);

      // @TODO: should we remove it and only update form applyProperty
      // Update state vector if enabled
      if (this._stateVectorEnabled) {
        this.stateVector.updateFromOp(op);
      }
    };

    // Register the observer
    doc.on('update', ydocObserver);
    this.yjsObservers.set(propertyKey, ydocObserver);
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

    if (isModifyPropertyOp(op)) {
      this.applyModifyProperty(op, targetVertex);
    } else {
      this.applyLLWProperty(op, targetVertex);
    }
  }

  private applyLLWProperty(op: SetVertexProperty, targetVertex: VertexState) {
    const prevTransientOpId = this.transientPropertiesAndTheirOpIds.get(`${op.key}@${op.targetId}`);
    const prevOpId = this.propertiesAndTheirOpIds.get(`${op.key}@${op.targetId}`);

    if (!op.transient) {
      this.setPropertyOps.push(op);

      // Apply the property if it's not already applied or if the current op is newer
      // This is the last writer wins approach that ensures the same state between replicas.
      if (!prevOpId || isOpIdGreaterThan(op.id, prevOpId)) {
        this.setLLWPropertyAndItsOpId(op);
              } else {
          // We add it to set of known ops to avoid adding them to `setPropertyOps` multiple times 
          // if we ever receive the same op from another peer.
          this.knownOps.add(opIdToString(op.id));
        }

      // Remove the transient property if the current op is greater
      if (prevTransientOpId && isOpIdGreaterThan(op.id, prevTransientOpId)) {
        this.transientPropertiesAndTheirOpIds.delete(`${op.key}@${op.targetId}`);
        targetVertex.removeTransientProperty(op.key);
      }

    } else {
      // Handle transient properties
      if (!prevTransientOpId || isOpIdGreaterThan(op.id, prevTransientOpId)) {
        this.setTransientPropertyAndItsOpId(op);
      }
    }
  }

  private applyModifyProperty(op: SetVertexProperty, targetVertex: VertexState) {
    if (op.transient) {
      console.warn("Not implemented: transient non LWW property");
      return;
    }

    this.setPropertyOps.push(op);
    const crdtValue = op.value as CRDTType;

    if (crdtValue.type !== "yjs") {
      throw new Error("Unknown CRDT type");
    }

    const ydoc = targetVertex.getProperty(op.key);

    if (ydoc instanceof Y.Doc) {
      // Apply update to existing Y.Doc
      Y.applyUpdate(ydoc, crdtValue.value);
    } else {
      // Create new Y.Doc, and apply an update
      const newDoc = new Y.Doc();
      // Setup an observer so we can automatically create ops when the doc changes
      this.setupYjsObserver(newDoc, op.targetId, op.key);
      // Set the new doc as a property on the vertex
      this.state.setProperty(op.targetId, op.key, newDoc);
      // And finally, apply the update to the new doc
      Y.applyUpdate(newDoc, crdtValue.value);
    }

    this.propertiesAndTheirOpIds.set(`${op.key}@${op.targetId}`, op.id);
    this.reportOpAsApplied(op);

    // @TODO: should we update state vector here?
  }

  private applyOperation(op: VertexOperation) {
    if (isMoveVertexOp(op)) {
      this.applyMove(op);
    } else if (isAnyPropertyOp(op)) {
      this.applyProperty(op);
    }
  }

  private reportOpAsApplied(op: VertexOperation) {
    this.knownOps.add(opIdToString(op.id));

    if (this._stateVectorEnabled) {
      this.stateVector.updateFromOp(op);
    }

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
        this.applyProperty(prop);
      }
    }
  }

  private undoMove(op: MoveVertex) {
    const targetVertex = this.state.getVertex(op.targetId);
    if (!targetVertex) {
      console.error(`An attempt to undo move operation ${opIdToString(op.id)} failed because the target vertex ${op.targetId} not found`);
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
   * Returns the current state vector.
   * Returns a readonly reference to the internal state vector.
   */
  getStateVector(): Readonly<Record<string, number[][]>> | null {
    if (!this._stateVectorEnabled) {
      return null;
    }
    return this.stateVector.getState();
  }

  /**
   * Determines which operations are needed to synchronize 
   * with the provided state vector.
   * 
   * @param theirStateVector The state vector from another peer
   * @returns Operations that should be sent to the other peer, sorted by OpId.
   */
  getMissingOps(theirStateVector: Record<string, number[][]>): VertexOperation[] {
    // If state vector is disabled, fallback to sending all ops
    if (!this._stateVectorEnabled) {
      return [...this.moveOps, ...this.setPropertyOps];
    }

    // Create a StateVector instance from their state vector
    const otherStateVector = new StateVector(theirStateVector);

    // Get the missing ranges
    const missingRanges = this.stateVector.diff(otherStateVector);

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
    missingOps.sort((a, b) => compareOpId(a.id, b.id));

    return missingOps;
  }

  /**
   * Gets or sets whether state vector tracking is enabled
   */
  get stateVectorEnabled(): boolean {
    return this._stateVectorEnabled;
  }

  /**
   * Sets the state vector enabled status
   * When enabled, rebuilds the state vector from existing operations if needed
   */
  set stateVectorEnabled(value: boolean) {
    if (value === this._stateVectorEnabled) return;

    if (value) {
      // Enable state vector and rebuild from existing operations
      this._stateVectorEnabled = true;
      this.stateVector = StateVector.fromOperations([...this.moveOps, ...this.setPropertyOps]);
    } else {
      // Disable state vector and clear it to save memory
      this._stateVectorEnabled = false;
      this.stateVector = new StateVector();
    }
  }
}