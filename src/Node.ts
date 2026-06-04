import type { NodeState } from "./NodeState";
import type { RepTree } from "./RepTree";
import { bindNode, type SchemaLike, type BindOptions, type BindedNode } from './reactive';
import type { NodeChangeEvent, NodePropertyType } from "./treeTypes";

/**
 * A wrapper class for NodeState that provides a more convenient API
 * for working with nodes in a RepTree.
 */
export class Node {
  private _tree: RepTree;

  constructor(
    tree: RepTree,
    private state: NodeState
  ) {
    this._tree = tree;
  }

  /** Returns the tree this node belongs to. */
  public get tree(): RepTree {
    return this._tree;
  }

  private set tree(value: RepTree) {
    this._tree = value;
  }

  /** Returns the ID of this node. */
  get id(): string {
    return this.state.id;
  }

  /** Returns the name of this node. The name is stored as a property with the key 'name'. */
  get name(): string | undefined {
    return this.getProperty('name') as string | undefined;
  }

  /** Sets the name of this node. The name is stored as a property with the key 'name'. */
  set name(name: string) {
    this.tree.setNodeProperty(this.id, 'name', name);
  }

  /** Returns the creation date of this node. The creation date is stored as a property with the key '_c'. */
  get createdAt(): Date {
    const createdAt = this.getProperty('_c') as string;
    if (!createdAt) {
      return new Date(0);
    }
    return new Date(createdAt);
  }

  /** Returns the ID of the parent node of this node. */
  get parentId(): string | null {
    return this.state.parentId;
  }

  /** Returns the parent node of this node. */
  get parent(): Node | undefined {
    if (!this.parentId) {
      return undefined;
    }

    return this.tree.getNode(this.parentId);
  }

  /** Returns the children nodes of this node. */
  get children(): Node[] {
    return this.tree.getChildren(this.id);
  }

  /** Returns the IDs of the children nodes of this node. */
  get childrenIds(): string[] {
    return this.tree.getChildrenIds(this.id);
  }

  /** Returns the ancestors of this node. The first element is the root node.
   * E.g root -> grandparent -> parent.
   * Doesn't include this node in the array.
   */
  get ancestors(): Node[] {
    return this.tree.getAncestors(this.id);
  }

  /** Returns the ID of the root node of the tree this node belongs to. */
  get treeId(): string {
    return this.root.id;
  }

  /** Returns the root node of the tree this node belongs to. */
  get root(): Node {
    const root = this.tree.root;
    if (!root) {
      throw new Error('Root node of the tree is not set');
    }
    return root;
  }

  getAsTypedObject<T>(): T {
    return this.getProperties() as T;
  }

  getChildrenAsTypedArray<T>(): T[] {
    return this.children.map(v => v.getAsTypedObject<T>());
  }

  /** Creates a new child node of this node. */
  newChild(props?: Record<string, NodePropertyType> | object | null): Node {
    return this.tree.newNode(this.id, props);
  }

  /** Creates a new named child node of this node. */
  newNamedChild(name: string, props?: Record<string, NodePropertyType> | object | null): Node {
    return this.tree.newNamedNode(this.id, name, props);
  }

  /** Sets a property on this node. */
  setProperty(key: string, value: NodePropertyType): void {
    // First check if the property is already set (not including transient properties)
    const existingValue = this.getProperty(key, false);
    if (existingValue === value) {
      return;
    }

    this.tree.setNodeProperty(this.id, key, value);
  }

  /** Sets a transient property on this node. Transient properties are not persisted to the tree and are not included in the state vector. */
  setTransientProperty(key: string, value: NodePropertyType): void {
    // First check if the property is already set
    const existingValue = this.getProperty(key);
    if (existingValue === value) {
      return;
    }

    this.tree.setTransientNodeProperty(this.id, key, value);
  }

  /** Promotes all transient (temporary) properties to persistent properties. */
  commitTransients(): void {
    this.tree.commitTransients(this.id);
  }

  /** Sets multiple properties on this node. */
  setProperties(props: Record<string, NodePropertyType> | object): void {
    for (const [key, value] of Object.entries(props)) {
      this.setProperty(key, value);
    }
  }

  /** Returns the value of a property on this node. */
  getProperty(key: string, includingTransient: boolean = true): NodePropertyType | undefined {
    return this.tree.getNodeProperty(this.id, key, includingTransient);
  }

  /** Returns all properties on this node. */
  getProperties(): Record<string, NodePropertyType> {
    const props: Record<string, NodePropertyType> = {};
    this.tree.getNodeProperties(this.id).forEach(p => {
      props[p.key] = p.value;
    });
    return props;
  }

  findAllChildrenWithProperty(key: string, value: NodePropertyType): Node[] {
    return this.children.filter(c => c.getProperty(key) === value);
  }

  findFirstChildNodeWithProperty(key: string, value: NodePropertyType): Node | undefined {
    return this.children.find(c => c.getProperty(key) === value);
  }

  findFirstTypedChildWithProperty<T>(key: string, value: NodePropertyType): T | undefined {
    return this.findFirstChildNodeWithProperty(key, value)?.getAsTypedObject<T>();
  }

  findAllTypedChildrenWithProperty<T>(key: string, value: NodePropertyType): T[] {
    return this.findAllChildrenWithProperty(key, value).map(c => c.getAsTypedObject<T>());
  }

  /** Observes changes to this node. */
  observe(listener: (events: NodeChangeEvent[]) => void): () => void {
    const unobserve = this.tree.observe(this.id, listener);
    return () => unobserve();
  }

  /** Observes changes to the children of this node. */
  observeChildren(listener: (children: Node[]) => void): () => void {
    const unobserve = this.tree.observe(this.id, (events: NodeChangeEvent[]) => {
      if (events.some(e => e.type === 'children')) {
        listener(this.children);
      }
    });
    return () => unobserve();
  }

  observeChildrenAsTypedArray<T>(listener: (children: T[]) => void): () => void {
    return this.observeChildren((children) => {
      listener(children.map(c => c.getProperties() as unknown as T));
    });
  }

  delete(): void {
    this.tree.deleteNode(this.id);
  }

  moveTo(parent: Node): void {
    this.tree.moveNode(this.id, parent.id);
  }

  /** Returns a live reactive object bound to this node. Accepts schema or options. */
  bind<T extends Record<string, unknown>>(schemaOrOptions?: SchemaLike<T> | BindOptions<T>): BindedNode<T> {
    return bindNode<T>(this.tree, this.id, schemaOrOptions as any);
  }
}