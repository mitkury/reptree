import type { VertexState } from "./VertexState";
import type { RepTree } from "./RepTree";
import { bindVertex, type SchemaLike, type BindOptions, type BindedVertex } from './reactive';
import type { VertexChangeEvent, VertexPropertyType } from "./treeTypes";

/**
 * A wrapper class for VertexState that provides a more convenient API
 * for working with vertices in a RepTree.
 */
export class Vertex {
  private _tree: RepTree;

  constructor(
    tree: RepTree,
    private state: VertexState
  ) {
    this._tree = tree;
  }

  /** Returns the tree this vertex belongs to. */
  public get tree(): RepTree {
    return this._tree;
  }

  private set tree(value: RepTree) {
    this._tree = value;
  }

  /** Returns the ID of this vertex. */
  get id(): string {
    return this.state.id;
  }

  /** Returns the name of this vertex. The name is stored as a property with the key 'name'. */
  get name(): string | undefined {
    return this.getProperty('name') as string | undefined;
  }

  /** Sets the name of this vertex. The name is stored as a property with the key 'name'. */
  set name(name: string) {
    this.tree.setVertexProperty(this.id, 'name', name);
  }

  /** Returns the creation date of this vertex. The creation date is stored as a property with the key '_c'. */
  get createdAt(): Date {
    const createdAt = this.getProperty('_c') as string;
    if (!createdAt) {
      return new Date(0);
    }
    return new Date(createdAt);
  }

  /** Returns the ID of the parent vertex of this vertex. */
  get parentId(): string | null {
    return this.state.parentId;
  }

  /** Returns the parent vertex of this vertex. */
  get parent(): Vertex | undefined {
    if (!this.parentId) {
      return undefined;
    }

    return this.tree.getVertex(this.parentId);
  }

  /** Returns the children vertices of this vertex. */
  get children(): Vertex[] {
    return this.tree.getChildren(this.id);
  }

  /** Returns the IDs of the children vertices of this vertex. */
  get childrenIds(): string[] {
    return this.tree.getChildrenIds(this.id);
  }

  /** Returns the ancestors of this vertex. The first element is the root vertex.
   * E.g root -> grandparent -> parent.
   * Doesn't include this vertex in the array.
   */
  get ancestors(): Vertex[] {
    return this.tree.getAncestors(this.id);
  }

  /** Returns the ID of the root vertex of the tree this vertex belongs to. */
  get treeId(): string {
    return this.root.id;
  }

  /** Returns the root vertex of the tree this vertex belongs to. */
  get root(): Vertex {
    const root = this.tree.root;
    if (!root) {
      throw new Error('Root vertex of the tree is not set');
    }
    return root;
  }

  getAsTypedObject<T>(): T {
    return this.getProperties() as T;
  }

  getChildrenAsTypedArray<T>(): T[] {
    return this.children.map(v => v.getAsTypedObject<T>());
  }

  /** Creates a new child vertex of this vertex. */
  newChild(props?: Record<string, VertexPropertyType> | object | null): Vertex {
    return this.tree.newVertex(this.id, props);
  }

  /** Creates a new named child vertex of this vertex. */
  newNamedChild(name: string, props?: Record<string, VertexPropertyType> | object | null): Vertex {
    return this.tree.newNamedVertex(this.id, name, props);
  }

  /** Sets a property on this vertex. */
  setProperty(key: string, value: VertexPropertyType): void {
    // First check if the property is already set (not including transient properties)
    const existingValue = this.getProperty(key, false);
    if (existingValue === value) {
      return;
    }

    this.tree.setVertexProperty(this.id, key, value);
  }

  /** Sets a transient property on this vertex. Transient properties are not persisted to the tree and are not included in the state vector. */
  setTransientProperty(key: string, value: VertexPropertyType): void {
    // First check if the property is already set
    const existingValue = this.getProperty(key);
    if (existingValue === value) {
      return;
    }

    this.tree.setTransientVertexProperty(this.id, key, value);
  }

  /** Promotes all transient (temporary) properties to persistent properties. */
  commitTransients(): void {
    this.tree.commitTransients(this.id);
  }

  /** Sets multiple properties on this vertex. */
  setProperties(props: Record<string, VertexPropertyType> | object): void {
    for (const [key, value] of Object.entries(props)) {
      this.setProperty(key, value);
    }
  }

  /** Returns the value of a property on this vertex. */
  getProperty(key: string, includingTransient: boolean = true): VertexPropertyType | undefined {
    return this.tree.getVertexProperty(this.id, key, includingTransient);
  }

  /** Returns all properties on this vertex. */
  getProperties(): Record<string, VertexPropertyType> {
    const props: Record<string, VertexPropertyType> = {};
    this.tree.getVertexProperties(this.id).forEach(p => {
      props[p.key] = p.value;
    });
    return props;
  }

  findAllChildrenWithProperty(key: string, value: VertexPropertyType): Vertex[] {
    return this.children.filter(c => c.getProperty(key) === value);
  }

  findFirstChildVertexWithProperty(key: string, value: VertexPropertyType): Vertex | undefined {
    return this.children.find(c => c.getProperty(key) === value);
  }

  findFirstTypedChildWithProperty<T>(key: string, value: VertexPropertyType): T | undefined {
    return this.findFirstChildVertexWithProperty(key, value)?.getAsTypedObject<T>();
  }

  findAllTypedChildrenWithProperty<T>(key: string, value: VertexPropertyType): T[] {
    return this.findAllChildrenWithProperty(key, value).map(c => c.getAsTypedObject<T>());
  }

  /** Observes changes to this vertex. */
  observe(listener: (events: VertexChangeEvent[]) => void): () => void {
    const unobserve = this.tree.observe(this.id, listener);
    return () => unobserve();
  }

  /** Observes changes to the children of this vertex. */
  observeChildren(listener: (children: Vertex[]) => void): () => void {
    const unobserve = this.tree.observe(this.id, (events: VertexChangeEvent[]) => {
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
    this.tree.deleteVertex(this.id);
  }

  moveTo(parent: Vertex): void {
    this.tree.moveVertex(this.id, parent.id);
  }

  /** Returns a live reactive object bound to this vertex. Accepts schema or options. */
  bind<T extends Record<string, unknown>>(schemaOrOptions?: SchemaLike<T> | BindOptions<T>): BindedVertex<T> {
    return bindVertex<T>(this.tree, this.id, schemaOrOptions as any);
  }
} 