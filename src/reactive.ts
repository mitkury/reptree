import type { RepTree } from './RepTree';
import type { Vertex } from './Vertex';

export type FieldSchemaLike = {
  safeParse?: (input: unknown) => { success: true; data: unknown } | { success: false };
};

export type SchemaLike<T> = {
  safeParse?: (input: unknown) => { success: true; data: T } | { success: false };
  parse?: (input: unknown) => T;
  shape?: Record<string, FieldSchemaLike>;
};

export type BindOptions<T> = {
  schema?: SchemaLike<T>;
  includeInternalKeys?: boolean;
};

/**
 * A bound vertex object that forwards reads/writes to a vertex.
 * @param T - The type of the vertex.
 */
export type BindedVertex<T> = T & {

  $vertex: Vertex;
  $id: string;
  $parentId: string | null;
  $parent: Vertex | undefined;
  $children: Vertex[];
  $childrenIds: string[];

  /**
   * Apply transient edits that override reads but do not persist yet.
   * @param fn 
   */
  $useTransients(fn: (t: T) => void): void;
  
  /**
   * Promote current transient overlays to persistent values.
   */
  $commitTransients(): void;
  
  /**
   * Move the vertex to a new parent.
   * @param parent - The new parent vertex or ID.
   */
  $moveTo(parent: Vertex | BindedVertex<any> | string): void;
  
  /**
   * Delete the vertex.
   */
  $delete(): void;
  
  /**
   * Observe changes to the vertex.
   * @param listener - The listener function to call when changes occur.
   */
  $observe(listener: (events: any[]) => void): () => void;
  
  /**
   * Observe changes to the children of the vertex.
   * @param listener - The listener function to call when children change.
   */
  $observeChildren(listener: (children: Vertex[]) => void): () => void;
  
  /**
   * Create a new child vertex.
   * @param props - The properties to set on the new child vertex.
   */
  
  $newChild(props?: Record<string, any> | object | null): Vertex;
  
  /**
   * Create a new named child vertex.
   * @param name - The name of the new child vertex.
   * @param props - The properties to set on the new child vertex.
   */
  $newNamedChild(name: string, props?: Record<string, any> | object | null): Vertex;
};

/**
 * Returns a live Proxy that forwards reads/writes to a vertex.
 * - Reads reflect the latest CRDT state (including transients by default)
 * - Writes persist to the CRDT with optional schema validation
 */
export function bindVertex<T extends Record<string, unknown>>(
  tree: RepTree,
  id: string,
  schemaOrOptions?: SchemaLike<T> | BindOptions<T>
): BindedVertex<T> {
  const isOptions =
    typeof schemaOrOptions === 'object' && schemaOrOptions !== null && (
      Object.prototype.hasOwnProperty.call(schemaOrOptions as object, 'includeInternalKeys') ||
      Object.prototype.hasOwnProperty.call(schemaOrOptions as object, 'schema')
    );

  const options = (isOptions
    ? (schemaOrOptions as BindOptions<T>)
    : { schema: schemaOrOptions as SchemaLike<T> }) as BindOptions<T>;

  const schema = options.schema;

  const obj: any = {};

  Object.defineProperties(obj, {
    $vertex: { get: () => tree.getVertex(id)!, enumerable: false, configurable: true },
    $id: { get: () => id, enumerable: false, configurable: true },
    $parentId: { get: () => tree.getVertex(id)?.parentId ?? null, enumerable: false, configurable: true },
    $parent: { get: () => tree.getVertex(id)?.parent, enumerable: false, configurable: true },
    $children: { get: () => tree.getChildren(id), enumerable: false, configurable: true },
    $childrenIds: { get: () => tree.getChildrenIds(id), enumerable: false, configurable: true },
    $moveTo: {
      value: (parent: any) => {
        const parentId = typeof parent === 'object' && parent !== null ? (parent.id || parent.$id) : parent;
        tree.moveVertex(id, parentId);
      },
      enumerable: false,
      configurable: true,
      writable: false,
    },
    $delete: { value: () => tree.deleteVertex(id), enumerable: false, configurable: true, writable: false },
    $observe: { value: (listener: (events: any[]) => void) => tree.observe(id, listener), enumerable: false, configurable: true, writable: false },
    $observeChildren: {
      value: (listener: (children: Vertex[]) => void) =>
        tree.observe(id, (events: any[]) => {
          if (events.some((e: any) => e.type === 'children')) {
            listener(tree.getChildren(id));
          }
        }),
      enumerable: false,
      configurable: true,
      writable: false,
    },
    $newChild: { value: (props?: Record<string, any> | object | null) => tree.getVertex(id)!.newChild(props), enumerable: false, configurable: true, writable: false },
    $newNamedChild: { value: (name: string, props?: Record<string, any> | object | null) => tree.getVertex(id)!.newNamedChild(name, props), enumerable: false, configurable: true, writable: false },
    $useTransients: {
      value: function (fn: (t: any) => void) {
        const transientProxy = new Proxy({} as any, {
          set(_, prop: string | symbol, value: unknown) {
            if (typeof prop === 'string') {
              tree.setTransientVertexProperty(id, prop, value as any);
            }
            return true;
          },
          get(_, prop: string | symbol) {
            if (typeof prop !== 'string') return undefined;
            const rawValue = tree.getVertexProperty(id, prop, true);
            return rawValue as unknown;
          },
        });
        fn(transientProxy);
      },
      enumerable: false,
      configurable: true,
      writable: false,
    },
    $commitTransients: { value: () => tree.commitTransients(id), enumerable: false, configurable: true, writable: false },
    equals: {
      value: function (other: any) {
        if (other && typeof other === 'object' && '$id' in other) {
          return other.$id === id;
        }
        return false;
      },
      enumerable: false,
      configurable: true,
      writable: false,
    },
  });

  const proxy = new Proxy(obj, {
    get(target, prop: string | symbol, receiver) {
      if (typeof prop !== 'string') {
        return Reflect.get(target, prop, receiver);
      }
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      const rawValue = tree.getVertexProperty(id, prop, true);
      return rawValue;
    },

    set(target, prop: string | symbol, value: unknown) {
      if (typeof prop !== 'string') {
        return Reflect.set(target, prop, value);
      }

      if (schema?.shape && schema.shape[prop]) {
        const field = schema.shape[prop]!;
        if (field.safeParse) {
          const res = field.safeParse(value);
          if (!res.success) throw new Error(`Invalid value for ${prop}`);
          value = (res as any).data;
        }
      }

      tree.setVertexProperty(id, prop, value as any);
      return true;
    },

    deleteProperty(_target, prop: string | symbol) {
      if (typeof prop !== 'string') {
        return true;
      }
      tree.setVertexProperty(id, prop, undefined as any);
      return true;
    },
  });

  return proxy as BindedVertex<T>;
}
