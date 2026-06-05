import {
  newMoveNodeOp,
  type MoveNode,
  type SetNodeProperty,
  isMoveNodeOp,
  type NodeOperation,
  newSetNodePropertyOp,
  newSetTransientNodePropertyOp,
  isAnyPropertyOp
} from "./operations";
import type { NodePropertyType, TreeNodeProperty, NodeChangeEvent, TreeNodeId, NodeMoveEvent, StateVectors } from "./treeTypes";
import { NodeState } from "./NodeState";
import { TreeState } from "./TreeState";
import { type OpId, compareOpId, equalsOpId, isOpIdGreaterThan, opIdToString } from "./OpId";
import uuid from "./utils/uuid";
import { Node } from './Node';
import { StateVector } from './StateVector';
import deepEqual from './utils/deepEqual';
import isJsonValue from './utils/isJsonValue';

type PropertyKeyAtNodeId = `${string}@${TreeNodeId}`;

/**
 * RepTree is a tree data structure for storing nodes with properties.
 * It uses 2 conflict-free replicated data types (CRDTs) to manage seamless replication between peers.
 * A move tree CRDT is used for the tree structure (https://martin.kleppmann.com/papers/move-op.pdf).
 * A last writer wins (LWW) CRDT is used for properties.
 */
export class RepTree {
  private static NULL_NODE_ID = '0';

  readonly peerId: string;
  private rootNodeId: string | undefined;

  private moveClock = 0;
  private propClock = 0;
  private state: TreeState;
  private moveOps: MoveNode[] = [];
  private propertyOpsByKey: Map<PropertyKeyAtNodeId, SetNodeProperty> = new Map();
  private transientPropertiesAndTheirOpIds: Map<PropertyKeyAtNodeId, OpId> = new Map();
  private localOps: NodeOperation[] = [];
  private pendingMovesWithMissingParent: Map<string, MoveNode[]> = new Map();
  private pendingPropertiesWithMissingNode: Map<string, SetNodeProperty[]> = new Map();
  private knownOps: Set<string> = new Set();
  private parentIdBeforeMove: Map<OpId, string | null | undefined> = new Map();
  private opAppliedCallbacks: ((op: NodeOperation) => void)[] = [];

  // State vector tracking operations from each peer
  private moveStateVector: StateVector;
  private propStateVector: StateVector;
  private _stateVectorEnabled: boolean = true;

  /**
   * @param peerId - The peer ID of the current client. Should be unique across all peers.
   * @param ops - The operations to replicate an existing tree, if not provided - an empty tree will be created without a root node
   */
  constructor(peerId: string, ops?: ReadonlyArray<NodeOperation>) {
    this.peerId = peerId;
    this.state = new TreeState();

    // Initialize state vector (enabled by default)
    this.moveStateVector = new StateVector();
    this.propStateVector = new StateVector();

    if (ops && ops.length > 0) {
      this.applyOps(ops);

      const root = this.root;
      if (!root) {
        throw new Error('There has to be a root node in the operations');
      }

      // @TODO: validate the tree structure, throw an exception if it's invalid
    }
    else {
      // @TODO: consider to remove it. It creates an extra null node op in every new empty tree. We probably don't need to do it.
      this.ensureNullNode();
    }
  }

  dispose(): void {
    this.state.dispose();
  }

  get root(): Node | undefined {
    // In case if the root was created from the ops (not explicitly), then we need to find it in the state.
    if (!this.rootNodeId) {
      const nodes = this.state.getAllNodes();
      for (const node of nodes) {
        if (node.parentId === null && node.id !== RepTree.NULL_NODE_ID) {
          this.rootNodeId = node.id;
          return new Node(this, node);
        }
      }

      return undefined;
    }

    const rootNode = this.state.getNode(this.rootNodeId);
    if (!rootNode) {
      throw new Error("Root node not found");
    }

    return new Node(this, rootNode);
  }

  replicate(newPeerId: string): RepTree {
    return new RepTree(newPeerId, this.getAllOps());
  }

  getMoveOps(): ReadonlyArray<MoveNode> {
    return this.moveOps;
  }

  getAllOps(): ReadonlyArray<NodeOperation> {
    return [...this.moveOps, ...this.getPropertyOps()];
  }

  getNode(nodeId: string): Node | undefined {
    const node = this.state.getNode(nodeId);
    return node ? new Node(this, node) : undefined;
  }

  getAllNodes(): ReadonlyArray<Node> {
    return this.state.getAllNodes().map(v => new Node(this, v));
  }

  getParent(nodeId: string): Node | undefined {
    const parentId = this.state.getNode(nodeId)?.parentId;
    const parent = parentId ? this.state.getNode(parentId) : undefined;
    return parent ? new Node(this, parent) : undefined;
  }

  getChildren(nodeId: string): Node[] {
    return this.state.getChildren(nodeId).map(v => new Node(this, v));
  }

  getChildrenIds(nodeId: string): string[] {
    return this.state.getChildrenIds(nodeId);
  }

  /** Returns the ancestors of the given node. The first element is the root node. */
  getAncestors(nodeId: string): Node[] {
    const ancestors: Node[] = [];
    let currentNode = this.state.getNode(nodeId);

    while (currentNode && currentNode.parentId) {
      const parentNode = this.state.getNode(currentNode.parentId);
      if (parentNode) {
        ancestors.push(new Node(this, parentNode));
        currentNode = parentNode;
      } else {
        break;
      }
    }

    return ancestors;
  }

  getNodeProperty(nodeId: string, key: string, includingTransient: boolean = true): NodePropertyType | undefined {
    const node = this.state.getNode(nodeId);
    if (!node) {
      return undefined;
    }

    return node.getProperty(key, includingTransient);
  }

  getNodeProperties(nodeId: string): Readonly<TreeNodeProperty[]> {
    const node = this.state.getNode(nodeId);
    if (!node) {
      return [];
    }

    return node.getAllProperties();
  }

  /**
   * Returns all local operations and clears the local operations list.
   * Can be used to get all operations that were generated from this peer and need to be sent to other peers.
   */
  popLocalOps(): NodeOperation[] {
    const ops = this.localOps;
    this.localOps = [];
    return ops;
  }

  /**
   * This is the first node that will contain all other nodes.
   * If you plan to replicate a tree then don't use this method and instead merge
   * in the ops from another tree (that will also contain the root node).
   * @returns The root node
   */
  createRoot(): Node {
    if (this.rootNodeId) {
      throw new Error('Root node already exists');
    }

    this.rootNodeId = this.newNodeInternalWithUUID(null);

    const rootNode = this.state.getNode(this.rootNodeId);
    if (!rootNode) {
      throw new Error("Root node not found");
    }

    return new Node(this, rootNode);
  }

  newNode(parentId: string, props: Record<string, NodePropertyType> | object | null = null): Node {
    const typedProps = props as Record<string, NodePropertyType> | null;
    const nodeId = this.newNodeInternalWithUUID(parentId);
    if (typedProps) {
      this.setNodeProperties(nodeId, typedProps);
    }

    const node = this.state.getNode(nodeId);
    if (!node) {
      throw new Error('Failed to create node');
    }
    return new Node(this, node);
  }

  newNamedNode(parentId: string, name: string, props: Record<string, NodePropertyType> | object | null = null): Node {
    const typedProps = props as Record<string, NodePropertyType> | null;
    const nodeId = this.newNodeInternalWithUUID(parentId);
    if (typedProps) {
      this.setNodeProperties(nodeId, typedProps);
    }
    this.setNodeProperty(nodeId, 'name', name);

    const node = this.state.getNode(nodeId);
    if (!node) {
      throw new Error('Failed to create named node');
    }
    return new Node(this, node);
  }

  moveNode(nodeId: string, parentId: string) {
    this.moveClock++;
    const op = newMoveNodeOp(this.moveClock, this.peerId, nodeId, parentId);
    this.localOps.push(op);
    this.applyMove(op);
  }

  deleteNode(nodeId: string) {
    this.moveNode(nodeId, RepTree.NULL_NODE_ID);
  }

  setTransientNodeProperty(nodeId: string, key: string, value: NodePropertyType) {
    if (!isJsonValue(value)) {
      throw new Error(`Unsupported transient property value for key "${key}"`);
    }

    this.propClock++;
    const op = newSetTransientNodePropertyOp(this.propClock, this.peerId, nodeId, key, value as NodePropertyType);
    this.localOps.push(op);
    this.applyProperty(op);
  }

  /**
   * Promotes all transient (temporary) properties to persistent properties.
   * @param nodeId - The ID of the node to commit transients for.
   * @returns
   */
  commitTransients(nodeId: string) {
    const node = this.state.getNode(nodeId);
    if (!node) {
      return;
    }

    const transientProps = node.getTransientProperties();

    // Promote each transient property to persistent
    for (const prop of transientProps) {
      this.setNodeProperty(nodeId, prop.key, prop.value);
    }

    // Clear transient OpIds tracking
    for (const prop of transientProps) {
      this.transientPropertiesAndTheirOpIds.delete(`${prop.key}@${nodeId}`);
    }

    // Clear all transient properties from the node
    node.clearAllTransientProperties();
  }

  setNodeProperty(nodeId: string, key: string, value: NodePropertyType) {
    if (!isJsonValue(value)) {
      throw new Error(`Unsupported property value for key "${key}"`);
    }

    this.propClock++;
    const op = newSetNodePropertyOp(this.propClock, this.peerId, nodeId, key, value as NodePropertyType);
    this.localOps.push(op);
    this.applyProperty(op);
  }

  setNodeProperties(nodeId: string, props: Record<string, NodePropertyType> | object) {
    const typedProps = props as Record<string, NodePropertyType>;
    for (const [key, value] of Object.entries(typedProps)) {
      this.setNodeProperty(nodeId, key, value);
    }
  }

  getNodeByPath(path: string): Node | undefined {
    // Let's remove '/' at the start and at the end of the path
    path = path.replace(/^\/+/, '');
    path = path.replace(/\/+$/, '');

    const root = this.root;
    if (!root) {
      return undefined;
    }

    if (path === '') {
      return root;
    }

    return this.getNodeByPathArray(root, path.split('/'));
  }

  private getNodeByPathArray(node: Node, path: string[]): Node | undefined {
    if (path.length === 0) {
      return node ?? undefined;
    }

    const targetName = path[0];
    // Now, search recursively by name 'name' in children until the path is empty or not found.
    const children = this.getChildren(node.id);
    for (const child of children) {
      if (child.getProperty('name') === targetName) {
        return this.getNodeByPathArray(child, path.slice(1));
      }
    }

    return undefined;
  }

  printTree() {
    if (!this.rootNodeId) {
      return '';
    }

    return this.state.printTree(this.rootNodeId);
  }

  merge(ops: ReadonlyArray<NodeOperation>) {
    /*
    if (ops.length > 100) {
      this.applyOpsOptimizedForLotsOfMoves(ops);
    } else {
      this.applyOps(ops);
    }
    */

    this.applyOps(ops);
  }

  private applyOps(ops: ReadonlyArray<NodeOperation>) {
    const moveOps = ops.filter(op => isMoveNodeOp(op));
    const propertyOps = ops.filter(op => isAnyPropertyOp(op));

    for (const op of moveOps) {
      // We skip the operation if we already know about it.
      // This is to avoid processing the same operation multiple times.
      if (this.knownOps.has(this.getOpKey(op))) {
        continue;
      }

      this.applyOperation(op);
    }

    for (const op of propertyOps) {
      if (this.knownOps.has(this.getOpKey(op))) {
        continue;
      }

      this.applyOperation(op);
    }
  }

  /** Applies operations in an optimized way, sorting move ops by OpId to avoid undo-do-redo cycles */
  private applyOpsOptimizedForLotsOfMoves(ops: ReadonlyArray<NodeOperation>) {
    const newMoveOps = ops.filter(op => isMoveNodeOp(op) && !this.knownOps.has(this.getOpKey(op)));
    if (newMoveOps.length > 0) {
      // Get an array of all move ops (without already applied ones)
      const allMoveOps = [...this.moveOps, ...newMoveOps] as MoveNode[];
      // The main point of this optimization is to apply the moves without undo-do-redo cycles (the conflict resolution algorithm).
      // That is why we sort by OpId.
      allMoveOps.sort((a, b) => compareOpId(a.id, b.id));
      for (let i = 0, len = allMoveOps.length; i < len; i++) {
        const op = allMoveOps[i];
        this.applyMove(op);
      }
    }

    // Get an array of all property ops (without already applied ones)
    const propertyOps = ops.filter(op => isAnyPropertyOp(op) && !this.knownOps.has(this.getOpKey(op)));
    for (let i = 0, len = propertyOps.length; i < len; i++) {
      const op = propertyOps[i];
      this.applyProperty(op as SetNodeProperty);
    }
  }

  compareStructure(other: RepTree): boolean {
    if (this.root?.id !== other.root?.id) {
      return false;
    }

    if (!this.rootNodeId) {
      return true;
    }

    return RepTree.compareNodes(this.rootNodeId, this, other);
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

  /** Checks whether moving `targetId` under `parentId` would create a cycle. */
  wouldMoveCreateCycle(move: Pick<MoveNode, 'targetId' | 'parentId'>): boolean {
    if (move.targetId === move.parentId) return true;
    if (move.parentId === null) return false;

    return this.hasAncestor(move.parentId, move.targetId);
  }

  /**
   * Checks if the given `ancestorId` is an ancestor of `childId` in the tree.
   *
   * @deprecated Use `wouldMoveCreateCycle` for move validation.
   */
  isAncestor(childId: string, ancestorId: string | null): boolean {
    return this.hasAncestor(childId, ancestorId);
  }

  private hasAncestor(nodeId: string, ancestorId: string | null): boolean {
    let targetId = nodeId;
    let node: NodeState | undefined;

    // Set to track visited nodes and detect cycles
    const visitedNodes = new Set<string>();

    while (node = this.state.getNode(targetId)) {
      if (node.parentId === ancestorId) return true;
      if (!node.parentId) return false;

      // If we've already visited this node, we have a cycle
      if (visitedNodes.has(targetId)) {
        console.error(`hasAncestor: cycle detected in the tree structure.`);
        // The requested ancestor was not found before the cycle repeated.
        return false;
      }

      // Mark this node as visited
      visitedNodes.add(targetId);

      targetId = node.parentId;
    }

    return false;
  }

  observeNode(nodeId: string, callback: (updatedNode: Node) => void): () => void {
    const node = this.getNode(nodeId);
    if (node) {
      callback(node);
    }

    const unsubscribe = this.observe(nodeId, (_) => {
      const node = this.getNode(nodeId);
      if (node) {
        callback(node);
      }
    });

    return () => {
      unsubscribe();
    };
  }

  observeNodeMove(callback: (movedNode: Node, isNew: boolean) => void): () => void {
    const listener = (events: NodeChangeEvent[]) => {
      const moveEvent = events.find(e => e.type === 'move') as NodeMoveEvent | undefined;
      if (moveEvent) {
        const node = this.getNode(moveEvent.nodeId);
        if (node) {
          callback(node, moveEvent.oldParentId === undefined);
        }
      }
    };

    this.state.addGlobalChangeCallback(listener);

    return () => this.state.removeGlobalChangeCallback(listener);
  }

  observe(nodeId: string, callback: (events: NodeChangeEvent[]) => void): () => void {
    this.state.addChangeCallback(nodeId, callback);
    return () => this.state.removeChangeCallback(nodeId, callback);
  }

  observeOpApplied(callback: (op: NodeOperation) => void): () => void {
    this.opAppliedCallbacks.push(callback);
    return () => this.opAppliedCallbacks = this.opAppliedCallbacks.filter(l => l !== callback);
  }

  static compareNodes(nodeId: string, treeA: RepTree, treeB: RepTree): boolean {
    const childrenA = treeA.state.getChildrenIds(nodeId);
    const childrenB = treeB.state.getChildrenIds(nodeId);

    if (childrenA.length !== childrenB.length) {
      return false;
    }

    // Compare properties of the current node
    if (nodeId !== null) {
      const propertiesA = treeA.getNodeProperties(nodeId);
      const propertiesB = treeB.getNodeProperties(nodeId);

      if (propertiesA.length !== propertiesB.length) {
        return false;
      }

      for (const propA of propertiesA) {
        const propB = propertiesB.find(p => p.key === propA.key);
        if (!propB) return false;
        if (!deepEqual(propA.value, propB.value)) return false;
      }
    }

    // Compare children and their properties recursively
    for (const childId of childrenA) {
      if (!childrenB.includes(childId)) {
        return false;
      }

      if (!RepTree.compareNodes(childId, treeA, treeB)) {
        return false;
      }
    }

    return true;
  }

  private newNodeInternal(nodeId: string, parentId: string | null): string {
    this.moveClock++;
    // To create a node - we move a node with a fresh id under the parent.
    // No need to have a separate "create node" operation.
    const op = newMoveNodeOp(this.moveClock, this.peerId, nodeId, parentId);
    this.localOps.push(op);
    this.applyMove(op);

    // Set the creation date
    this.setNodeProperty(nodeId, '_c', new Date().toISOString());

    return nodeId;
  }

  private newNodeInternalWithUUID(parentId: string | null): string {
    const nodeId = uuid();
    return this.newNodeInternal(nodeId, parentId);
  }

  private ensureNullNode() {
    const nodeId = RepTree.NULL_NODE_ID;

    // Check if the null node already exists
    if (this.state.getNode(nodeId)) {
      return;
    }

    this.newNodeInternal(nodeId, null);
  }

  /** Updates the lamport clock with the counter value of the operation */
  private updateMoveClock(operation: MoveNode): void {
    // This is how Lamport clock updates with a foreign operation that has a greater counter value.
    if (operation.id.counter > this.moveClock) {
      this.moveClock = operation.id.counter;
    }
  }

  private updatePropClock(operation: SetNodeProperty): void {
    if (operation.id.counter > this.propClock) {
      this.propClock = operation.id.counter;
    }
  }

  private applyPendingMovesForParent(parentId: string) {
    // If a parent doesn't exist, we can't apply pending moves yet.
    if (!this.state.getNode(parentId)) {
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

  private applyMove(op: MoveNode) {
    // Check if a parent (unless we're dealing with the root node) exists for the move operation.
    // If it doesn't exist, stash the move op for later
    if (op.parentId !== null && !this.state.getNode(op.parentId)) {
      if (!this.pendingMovesWithMissingParent.has(op.parentId)) {
        this.pendingMovesWithMissingParent.set(op.parentId, []);
      }
      this.pendingMovesWithMissingParent.get(op.parentId)!.push(op);
      this.markOpSeen(op, true);
      return;
    }

    this.updateMoveClock(op);

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
    // We use targetId here because this node might now be a parent for pending operations
    this.applyPendingMovesForParent(op.targetId);
  }

  private setLLWPropertyAndItsOpId(op: SetNodeProperty) {
    this.propertyOpsByKey.set(`${op.key}@${op.targetId}`, op);
    this.state.setProperty(op.targetId, op.key, op.value);
    this.reportOpAsApplied(op, false);
    this.refreshPropStateVector();
  }

  private setTransientPropertyAndItsOpId(op: SetNodeProperty) {
    this.transientPropertiesAndTheirOpIds.set(`${op.key}@${op.targetId}`, op.id);
    this.state.setTransientProperty(op.targetId, op.key, op.value);
    this.reportOpAsApplied(op, false);
  }

  private applyProperty(op: SetNodeProperty) {
    const targetNode = this.state.getNode(op.targetId);
    if (!targetNode) {
      // No need to handle transient properties if the node doesn't exist
      if (op.transient) {
        return;
      }

      // If the node doesn't exist, we will wait for the move operation to appear that will create the node
      // so we can apply the property then.
      if (!this.pendingPropertiesWithMissingNode.has(op.targetId)) {
        this.pendingPropertiesWithMissingNode.set(op.targetId, []);
      }
      this.pendingPropertiesWithMissingNode.get(op.targetId)!.push(op);
      this.markOpSeen(op, false);
      return;
    }

    this.updatePropClock(op);

    this.applyLLWProperty(op, targetNode);
  }

  private applyLLWProperty(op: SetNodeProperty, targetNode: NodeState) {
    const prevTransientOpId = this.transientPropertiesAndTheirOpIds.get(`${op.key}@${op.targetId}`);
    const prevOpId = this.propertyOpsByKey.get(`${op.key}@${op.targetId}`)?.id;

    if (!op.transient) {
      // Apply the property if it's not already applied or if the current op is newer
      // This is the last writer wins approach that ensures the same state between replicas.
      if (!prevOpId || isOpIdGreaterThan(op.id, prevOpId)) {
        this.setLLWPropertyAndItsOpId(op);
      } else {
        this.markOpSeen(op, false);
      }

      // Remove the transient property if the current op is greater
      if (prevTransientOpId && isOpIdGreaterThan(op.id, prevTransientOpId)) {
        this.transientPropertiesAndTheirOpIds.delete(`${op.key}@${op.targetId}`);
        targetNode.removeTransientProperty(op.key);
      }

    } else {
      // Handle transient properties
      if (!prevTransientOpId || isOpIdGreaterThan(op.id, prevTransientOpId)) {
        this.setTransientPropertyAndItsOpId(op);
      } else {
        this.markOpSeen(op, false);
      }
    }
  }

  private applyOperation(op: NodeOperation) {
    if (isMoveNodeOp(op)) {
      this.applyMove(op);
    } else if (isAnyPropertyOp(op)) {
      this.applyProperty(op);
    }
  }

  private markOpSeen(op: NodeOperation, includeInStateVector: boolean) {
    this.knownOps.add(this.getOpKey(op));

    if (includeInStateVector && this._stateVectorEnabled) {
      if (isMoveNodeOp(op)) {
        this.moveStateVector.updateFromOp(op);
      } else if (isAnyPropertyOp(op)) {
        this.propStateVector.updateFromOp(op);
      }
    }
  }

  private reportOpAsApplied(op: NodeOperation, includeInStateVector: boolean = true) {
    this.markOpSeen(op, includeInStateVector);

    for (const callback of this.opAppliedCallbacks) {
      callback(op);
    }
  }

  private tryToMove(op: MoveNode) {
    let targetNode = this.state.getNode(op.targetId);

    if (targetNode) {
      // We cache the parentId before the move operation.
      // We will use it to undo the move according to the move op algorithm.
      this.parentIdBeforeMove.set(op.id, targetNode.parentId);
    }

    if (this.wouldMoveCreateCycle(op)) return;

    this.state.moveNode(op.targetId, op.parentId);

    // If the node didn't exist before the move - see if it has pending properties
    // and apply them.
    if (!targetNode) {
      const pendingProperties = this.pendingPropertiesWithMissingNode.get(op.targetId) || [];
      this.pendingPropertiesWithMissingNode.delete(op.targetId);
      for (const prop of pendingProperties) {
        this.applyProperty(prop);
      }
    }
  }

  private undoMove(op: MoveNode) {
    const targetNode = this.state.getNode(op.targetId);
    if (!targetNode) {
      console.error(`An attempt to undo move operation ${opIdToString(op.id)} failed because the target node ${op.targetId} not found`);
      return;
    }

    const prevParentId = this.parentIdBeforeMove.get(op.id);
    if (prevParentId === undefined) {
      return;
    }

    this.state.moveNode(op.targetId, prevParentId);
  }

  // --- Range-Based State Vector Methods ---

  /**
   * Returns the current state vectors for move and property streams.
   * Returns readonly references to the internal state vectors.
   */
  getStateVectors(): { move: Readonly<StateVectors["move"]>; prop: Readonly<StateVectors["prop"]> } | null {
    if (!this._stateVectorEnabled) {
      return null;
    }
    return {
      move: this.moveStateVector.getState(),
      prop: this.propStateVector.getState(),
    };
  }

  /**
   * Determines which operations are needed to synchronize
   * with the provided state vector.
   *
   * @param theirStateVectors The state vectors from another peer
   * @returns Operations that should be sent to the other peer, sorted by OpId within each stream.
   */
  getMissingOps(theirStateVectors: StateVectors): NodeOperation[] {
    // If state vector is disabled, fallback to sending all ops
    if (!this._stateVectorEnabled) {
      return [...this.moveOps, ...this.getPropertyOps()];
    }

    // Create a StateVector instance from their state vector
    const otherMoveStateVector = new StateVector(theirStateVectors.move);
    const otherPropStateVector = new StateVector(theirStateVectors.prop);

    // Get the missing ranges
    const missingMoveRanges = this.moveStateVector.diff(otherMoveStateVector);
    const missingPropRanges = this.propStateVector.diff(otherPropStateVector);

    // Then, retrieve only the operations that fall within those ranges
    const missingMoveOps = this.filterOpsByRanges(this.moveOps, missingMoveRanges);
    const missingPropOps = this.filterOpsByRanges(this.getPropertyOps(), missingPropRanges);

    // Sort the missing ops by OpId before returning, ensuring causal order
    missingMoveOps.sort((a, b) => compareOpId(a.id, b.id));
    missingPropOps.sort((a, b) => compareOpId(a.id, b.id));

    return [...missingMoveOps, ...missingPropOps];
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
      this.moveStateVector = StateVector.fromOperations(this.moveOps);
      this.propStateVector = StateVector.fromOperations(this.getPropertyOps());
    } else {
      // Disable state vector and clear it to save memory
      this._stateVectorEnabled = false;
      this.moveStateVector = new StateVector();
      this.propStateVector = new StateVector();
    }
  }

  /**
   * Parses the node properties with a provided schema that has a `parse` method (e.g., Zod schema)
   */
  parseNode<T>(nodeId: string, schema: { parse: (data: unknown) => T }): T {
    const propsArray = this.getNodeProperties(nodeId);
    const propsObject: Record<string, unknown> = {};
    for (const { key, value } of propsArray) {
      propsObject[key] = value as unknown;
    }
    return schema.parse(propsObject);
  }

  private getPropertyOps(): SetNodeProperty[] {
    return Array.from(this.propertyOpsByKey.values());
  }

  private refreshPropStateVector() {
    if (!this._stateVectorEnabled) {
      return;
    }

    this.propStateVector = StateVector.fromOperations(this.getPropertyOps());
  }

  private getOpKey(op: NodeOperation): string {
    const stream = isMoveNodeOp(op) ? "move" : "prop";
    return `${stream}:${opIdToString(op.id)}`;
  }

  private filterOpsByRanges<T extends NodeOperation>(ops: T[], ranges: { peerId: string; start: number; end: number }[]): T[] {
    const missingOps: T[] = [];
    for (const op of ops) {
      for (const range of ranges) {
        if (op.id.peerId === range.peerId &&
          op.id.counter >= range.start &&
          op.id.counter <= range.end) {
          missingOps.push(op);
          break;
        }
      }
    }
    return missingOps;
  }
}
