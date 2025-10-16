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

export type AliasRule = {
  publicKey: string;
  internalKey: string;
  toPublic?: (value: unknown) => unknown;
  toInternal?: (value: unknown) => unknown;
};

export const defaultAliases: AliasRule[] = [
  { publicKey: 'name', internalKey: '_n' },
  {
    publicKey: 'createdAt',
    internalKey: '_c',
    toPublic: (v: unknown) => (typeof v === 'string' ? new Date(v) : v),
    toInternal: (v: unknown) => (v instanceof Date ? v.toISOString() : v),
  },
];

export type BindOptions<T> = {
  schema?: SchemaLike<T>;
  aliases?: AliasRule[];
  includeInternalKeys?: boolean;
};

export type BindedVertex<T> = T & {
  // Transient overlay helpers
  useTransient(fn: (t: T) => void): void;
  commitTransients(): void;

  // Structural properties
  $id: string;
  $parentId: string | null;
  $parent: Vertex | undefined;
  $children: Vertex[];
  $childrenIds: string[];

  // Structural methods
  $moveTo(parent: Vertex | BindedVertex<any> | string): void;
  $delete(): void;
  $observe(listener: (events: any[]) => void): () => void;
  $observeChildren(listener: (children: Vertex[]) => void): () => void;
  $newChild(props?: Record<string, any> | object | null): Vertex | undefined;
  $newNamedChild(name: string, props?: Record<string, any> | object | null): Vertex | undefined;
};

function buildAliasMaps(aliases: AliasRule[]) {
  const publicToInternal = new Map<string, AliasRule>();
  const internalToPublic = new Map<string, AliasRule>();
  for (const rule of aliases) {
    publicToInternal.set(rule.publicKey, rule);
    internalToPublic.set(rule.internalKey, rule);
  }
  return { publicToInternal, internalToPublic };
}

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
      Object.prototype.hasOwnProperty.call(schemaOrOptions as object, 'aliases') ||
      Object.prototype.hasOwnProperty.call(schemaOrOptions as object, 'includeInternalKeys') ||
      Object.prototype.hasOwnProperty.call(schemaOrOptions as object, 'schema')
    );

  const options = (isOptions
    ? (schemaOrOptions as BindOptions<T>)
    : { schema: schemaOrOptions as SchemaLike<T> }) as BindOptions<T>;

  const schema = options.schema;
  const aliases = options.aliases ?? defaultAliases;
  const { publicToInternal } = buildAliasMaps(aliases);

  const obj: any = {};

  Object.defineProperties(obj, {
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
    $newChild: { value: (props?: Record<string, any> | object | null) => tree.getVertex(id)?.newChild(props), enumerable: false, configurable: true, writable: false },
    $newNamedChild: { value: (name: string, props?: Record<string, any> | object | null) => tree.getVertex(id)?.newNamedChild(name, props), enumerable: false, configurable: true, writable: false },
    useTransient: {
      value: function (fn: (t: any) => void) {
        const transientProxy = new Proxy({} as any, {
          set(_, prop: string | symbol, value: unknown) {
            if (typeof prop === 'string') {
              const rule = publicToInternal.get(prop);
              const internalKey = rule?.internalKey ?? prop;
              const internalValue = rule?.toInternal ? rule.toInternal(value) : value;
              tree.setTransientVertexProperty(id, internalKey, internalValue as any);
            }
            return true;
          },
          get(_, prop: string | symbol) {
            if (typeof prop !== 'string') return undefined;
            const rule = publicToInternal.get(prop);
            const internalKey = rule?.internalKey ?? prop;
            const rawValue = tree.getVertexProperty(id, internalKey, true);
            return rule?.toPublic ? rule.toPublic(rawValue as unknown) : rawValue;
          },
        });
        fn(transientProxy);
      },
      enumerable: false,
      configurable: true,
      writable: false,
    },
    commitTransients: { value: () => tree.commitTransients(id), enumerable: false, configurable: true, writable: false },
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

      const rule = publicToInternal.get(prop);
      const internalKey = rule?.internalKey ?? prop;
      const rawValue = tree.getVertexProperty(id, internalKey, true);
      return rule?.toPublic ? rule.toPublic(rawValue as unknown) : rawValue;
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

      const rule = publicToInternal.get(prop);
      const internalKey = rule?.internalKey ?? prop;
      const internalValue = rule?.toInternal ? rule.toInternal(value) : value;
      tree.setVertexProperty(id, internalKey, internalValue as any);
      return true;
    },

    deleteProperty(_target, prop: string | symbol) {
      if (typeof prop !== 'string') {
        return true;
      }
      const rule = publicToInternal.get(prop);
      const internalKey = rule?.internalKey ?? prop;
      tree.setVertexProperty(id, internalKey, undefined as any);
      return true;
    },
  });

  return proxy as BindedVertex<T>;
}
