import type { VertexState } from "./VertexState";
import type { RepTree } from "./RepTree";
import { bindVertex, type SchemaLike, type BindOptions, type BindedVertex } from './reactive';
import type { VertexChangeEvent, VertexPropertyType } from "./treeTypes";

/**
 * A wrapper class for VertexState that provides a more convenient API
 * for working with vertices in a RepTree.
 */
export class Vertex {
  constructor(
    private tree: RepTree,
    private state: VertexState
  ) { }

  get id(): string {
    return this.state.id;
  }

  get name(): string | undefined {
    return this.getProperty('name') as string | undefined;
  }

  set name(name: string) {
    this.tree.setVertexProperty(this.id, 'name', name);
  }

  get createdAt(): Date {
    const createdAt = this.getProperty('_c') as string;
    if (!createdAt) {
      return new Date(0);
    }
    return new Date(createdAt);
  }

  get path(): string {
    //return this.tree.getVertexPath(this.id);
    throw new Error('Not implemented');
  }

  get parentId(): string | null {
    return this.state.parentId;
  }

  get parent(): Vertex | undefined {
    if (!this.parentId) {
      return undefined;
    }

    return this.tree.getVertex(this.parentId);
  }

  get children(): Vertex[] {
    return this.tree.getChildren(this.id);
  }

  get childrenIds(): string[] {
    return this.tree.getChildrenIds(this.id);
  }

  getAsTypedObject<T>(): T {
    return this.getProperties() as T;
  }

  getChildrenAsTypedArray<T>(): T[] {
    return this.children.map(v => v.getAsTypedObject<T>());
  }

  newChild(props?: Record<string, VertexPropertyType> | object | null): Vertex {
    // Forbid nested children in props (not supported yet)
    if (props && typeof props === 'object' && 'children' in (props as any)) {
      throw new Error('Passing children inside props is not supported at the moment');
    }

    const normalized = Vertex.normalizePropsForCreation(props);
    return this.tree.newVertex(this.id, normalized);
  }

  newNamedChild(name: string, props?: Record<string, VertexPropertyType> | object | null): Vertex {
    // Forbid nested children in props (not supported yet)
    if (props && typeof props === 'object' && 'children' in (props as any)) {
      throw new Error('Passing children inside props is not supported at the moment');
    }

    const normalized = Vertex.normalizePropsForCreation(props);
    return this.tree.newNamedVertex(this.id, name, normalized);
  }

  setProperty(key: string, value: VertexPropertyType): void {
    // First check if the property is already set (not including transient properties)
    const existingValue = this.getProperty(key, false);
    if (existingValue === value) {
      return;
    }

    this.tree.setVertexProperty(this.id, key, value);
  }

  setTransientProperty(key: string, value: VertexPropertyType): void {
    // First check if the property is already set
    const existingValue = this.getProperty(key);
    if (existingValue === value) {
      return;
    }

    this.tree.setTransientVertexProperty(this.id, key, value);
  }

  commitTransients(): void {
    this.tree.commitTransients(this.id);
  }

  setProperties(props: Record<string, VertexPropertyType> | object): void {
    for (const [key, value] of Object.entries(props)) {
      this.setProperty(key, value);
    }
  }

  getProperty(key: string, includingTransient: boolean = true): VertexPropertyType | undefined {
    return this.tree.getVertexProperty(this.id, key, includingTransient);
  }

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

  observe(listener: (events: VertexChangeEvent[]) => void): () => void {
    const unobserve = this.tree.observe(this.id, listener);
    return () => unobserve();
  }

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

  /**
   * Normalizes an input props object for vertex creation:
   * - Filters unsupported field types with a console warning
   * - When a name param is provided to newNamedChild, ignores conflicting name in props
   */
  private static normalizePropsForCreation(props?: Record<string, VertexPropertyType> | object | null): Record<string, VertexPropertyType> | null {
    if (!props) return null;
    const input = props as Record<string, any>;
    const out: Record<string, VertexPropertyType> = {};
    const skipped: string[] = [];

    const isJsonValue = (v: any): v is VertexPropertyType => {
      if (v === null) return true; // null is allowed
      const t = typeof v;
      if (t === 'string' || t === 'number' || t === 'boolean') return true;
      if (Array.isArray(v)) return v.every(isJsonValue);
      if (t === 'object') {
        // Plain object with JSON-serializable values only
        // Exclude Date, Map, Set, RegExp, etc.
        const proto = Object.getPrototypeOf(v);
        if (proto !== Object.prototype && proto !== null) return false;
        for (const val of Object.values(v)) {
          if (!isJsonValue(val)) return false;
        }
        return true;
      }
      // functions, symbols, undefined (handled separately), bigint
      return false;
    };

    for (const [rawKey, rawValue] of Object.entries(input)) {
      if (rawValue === undefined) {
        // Skip undefined to avoid writing explicit undefineds on creation
        continue;
      }

      // Disallow nested children handled earlier; skip here defensively
      if (rawKey === 'children') continue;

      // Use keys as-is
      let key = rawKey;

      // Value normalization
      let value: any = rawValue;
      if (key === '_c') {
        if (value instanceof Date) {
          value = value.toISOString();
        } else if (typeof value === 'string') {
          // leave as is (assumed ISO)
        } else {
          skipped.push(rawKey);
          continue;
        }
      }

      if (!isJsonValue(value)) {
        skipped.push(rawKey);
        continue;
      }

      out[key] = value as VertexPropertyType;
    }

    if (skipped.length > 0) {
      throw new Error(`Unsupported property types for keys: ${skipped.join(', ')}`);
    }

    return Object.keys(out).length > 0 ? out : null;
  }
} 