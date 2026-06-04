import type { RepTree } from './RepTree';
import type { Node } from './Node';

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
 * A bound node object that forwards reads/writes to a node.
 * @param T - The type of the node.
 */
export type BindedNode<T> = T & {

  $node: Node;
  $id: string;
  $parentId: string | null;
  $parent: Node | undefined;
  $children: Node[];
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
   * Move the node to a new parent.
   * @param parent - The new parent node or ID.
   */
  $moveTo(parent: Node | BindedNode<any> | string): void;

  /**
   * Delete the node.
   */
  $delete(): void;

  /**
   * Observe changes to the node.
   * @param listener - The listener function to call when changes occur.
   */
  $observe(listener: (events: any[]) => void): () => void;

  /**
   * Observe changes to the children of the node.
   * @param listener - The listener function to call when children change.
   */
  $observeChildren(listener: (children: Node[]) => void): () => void;

  /**
   * Create a new child node.
   * @param props - The properties to set on the new child node.
   */

  $newChild(props?: Record<string, any> | object | null): Node;

  /**
   * Create a new named child node.
   * @param name - The name of the new child node.
   * @param props - The properties to set on the new child node.
   */
  $newNamedChild(name: string, props?: Record<string, any> | object | null): Node;
};

/**
 * Returns a live Proxy that forwards reads/writes to a node.
 * - Reads reflect the latest CRDT state (including transients by default)
 * - Writes persist to the CRDT with optional schema validation
 */
export function bindNode<T extends Record<string, unknown>>(
  tree: RepTree,
  id: string,
  schemaOrOptions?: SchemaLike<T> | BindOptions<T>
): BindedNode<T> {
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
    $node: { get: () => tree.getNode(id)!, enumerable: false, configurable: true },
    $id: { get: () => id, enumerable: false, configurable: true },
    $parentId: { get: () => tree.getNode(id)?.parentId ?? null, enumerable: false, configurable: true },
    $parent: { get: () => tree.getNode(id)?.parent, enumerable: false, configurable: true },
    $children: { get: () => tree.getChildren(id), enumerable: false, configurable: true },
    $childrenIds: { get: () => tree.getChildrenIds(id), enumerable: false, configurable: true },
    $moveTo: {
      value: (parent: any) => {
        const parentId = typeof parent === 'object' && parent !== null ? (parent.id || parent.$id) : parent;
        tree.moveNode(id, parentId);
      },
      enumerable: false,
      configurable: true,
      writable: false,
    },
    $delete: { value: () => tree.deleteNode(id), enumerable: false, configurable: true, writable: false },
    $observe: { value: (listener: (events: any[]) => void) => tree.observe(id, listener), enumerable: false, configurable: true, writable: false },
    $observeChildren: {
      value: (listener: (children: Node[]) => void) =>
        tree.observe(id, (events: any[]) => {
          if (events.some((e: any) => e.type === 'children')) {
            listener(tree.getChildren(id));
          }
        }),
      enumerable: false,
      configurable: true,
      writable: false,
    },
    $newChild: { value: (props?: Record<string, any> | object | null) => tree.getNode(id)!.newChild(props), enumerable: false, configurable: true, writable: false },
    $newNamedChild: { value: (name: string, props?: Record<string, any> | object | null) => tree.getNode(id)!.newNamedChild(name, props), enumerable: false, configurable: true, writable: false },
    $useTransients: {
      value: function (fn: (t: any) => void) {
        const transientProxy = new Proxy({} as any, {
          set(_, prop: string | symbol, value: unknown) {
            if (typeof prop === 'string') {
              tree.setTransientNodeProperty(id, prop, value as any);
            }
            return true;
          },
          get(_, prop: string | symbol) {
            if (typeof prop !== 'string') return undefined;
            const rawValue = tree.getNodeProperty(id, prop, true);
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
      const rawValue = tree.getNodeProperty(id, prop, true);
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

      tree.setNodeProperty(id, prop, value as any);
      return true;
    },

    deleteProperty(_target, prop: string | symbol) {
      if (typeof prop !== 'string') {
        return true;
      }
      tree.setNodeProperty(id, prop, undefined as any);
      return true;
    },
  });

  return proxy as BindedNode<T>;
}
