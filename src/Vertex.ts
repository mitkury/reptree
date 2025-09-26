import type { VertexState } from "./VertexState";
import type { RepTree } from "./RepTree";
import { bindVertex, type SchemaLike, type BindOptions } from './reactive';
import * as Y from 'yjs';
import type { VertexChangeEvent, VertexPropertyType } from "./treeTypes";

/**
 * A wrapper class for VertexState that provides a more convenient API
 * for working with vertices in a RepTree.
 */
export class Vertex {
  constructor(
    public tree: RepTree,
    private state: VertexState
  ) { }

  get id(): string {
    return this.state.id;
  }

  get name(): string | undefined {
    return this.getProperty('_n') as string | undefined;
  }

  set name(name: string) {
    this.tree.setVertexProperty(this.id, '_n', name);
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

    const normalized = Vertex.normalizePropsForCreation(props, name);
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
  bind<T extends Record<string, unknown>>(schemaOrOptions?: SchemaLike<T> | BindOptions<T>): T {
    return bindVertex<T>(this.tree, this.id, schemaOrOptions as any);
  }

  /**
   * Normalizes an input props object for vertex creation:
   * - Aliases name -> _n, createdAt -> _c (Date -> ISO string)
   * - Filters unsupported field types with a console warning
   * - When a name param is provided to newNamedChild, ignores conflicting name in props
   */
  private static normalizePropsForCreation(props?: Record<string, VertexPropertyType> | object | null, explicitName?: string): Record<string, VertexPropertyType> | null {
    if (!props) return null;
    const input = props as Record<string, any>;
    const out: Record<string, VertexPropertyType> = {};
    const skipped: string[] = [];

    for (const [rawKey, rawValue] of Object.entries(input)) {
      if (rawValue === undefined) {
        // Skip undefined to avoid writing explicit undefineds on creation
        continue;
      }

      // Disallow nested children handled earlier; skip here defensively
      if (rawKey === 'children') continue;

      // Alias mapping
      let key = rawKey;
      if (rawKey === 'name') {
        if (explicitName !== undefined) {
          // Explicit argument takes precedence
          console.warn('newNamedChild: "name" in props is ignored because a name argument was provided');
          continue;
        }
        key = '_n';
      } else if (rawKey === 'createdAt') {
        key = '_c';
      }

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

      const isPrimitive = (v: any) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

      if (Array.isArray(value)) {
        // Ensure array of primitives
        if (!value.every(isPrimitive)) {
          skipped.push(rawKey);
          continue;
        }
      } else if (typeof value === 'object' && value !== null) {
        if (!(value instanceof Y.Doc)) {
          // Unsupported nested object
          skipped.push(rawKey);
          continue;
        }
      } else if (!isPrimitive(value)) {
        skipped.push(rawKey);
        continue;
      }

      out[key] = value as VertexPropertyType;
    }

    if (skipped.length > 0) {
      console.warn(`Some fields were skipped due to unsupported types: ${skipped.join(', ')}`);
    }

    return Object.keys(out).length > 0 ? out : null;
  }
} 