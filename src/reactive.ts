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
  /**
   * Create a transient proxy that can be used to write transient properties.
   */
  useTransient(fn: (t: T) => void): void;

  /**
   * Promote transient properties to persistent.
   */
  commitTransients(): void;

  /** Vertex properties (prefixed with $ to avoid conflicts) */
  $id: string;
  $parentId: string | null;
  $parent: Vertex | undefined;
  $children: Vertex[];
  $childrenIds: string[];

  /** Vertex methods (prefixed with $ to avoid conflicts) */
  $moveTo(parent: Vertex | BindedVertex<any> | string): void;
  $delete(): void;
  $observe(listener: (events: any[]) => void): () => void;
  $observeChildren(listener: (children: Vertex[]) => void): () => void;
  $newChild(props?: Record<string, any> | object | null): Vertex;
  $newNamedChild(name: string, props?: Record<string, any> | object | null): Vertex;
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

function toPublicObject(tree: RepTree, id: string, internalToPublic: Map<string, AliasRule>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const { key, value } of tree.getVertexProperties(id)) {
    const rule = internalToPublic.get(key);
    if (rule) {
      const converted = rule.toPublic ? rule.toPublic(value as unknown) : (value as unknown);
      obj[rule.publicKey] = converted;
    } else {
      obj[key] = value as unknown;
    }
  }
  return obj;
}

// Reserved method names (string-based API for ergonomics)
const RESERVED_METHOD_USE_TRANSIENT = 'useTransient';
const RESERVED_METHOD_COMMIT_TRANSIENTS = 'commitTransients';

// Vertex property names (prefixed with $ to avoid conflicts)
const VERTEX_PROPS = ['$id', '$parentId', '$parent', '$children', '$childrenIds'] as const;

// Vertex method names (prefixed with $ to avoid conflicts)
const VERTEX_METHODS = ['$moveTo', '$delete', '$observe', '$observeChildren', '$newChild', '$newNamedChild'] as const;

/**
 * Returns a live object that proxies reads/writes to a vertex.
 * - Reads reflect the latest CRDT state.
 * - Writes persist to the CRDT.
 * - If a schema is provided, writes are validated. If a field schema exists in `schema.shape`, field-level validation is applied.
 */
export function bindVertex<T extends Record<string, unknown>>(
  tree: RepTree,
  id: string,
  schemaOrOptions?: SchemaLike<T> | BindOptions<T>
): BindedVertex<T> {
  const isOptions = typeof schemaOrOptions === 'object' && schemaOrOptions !== null && (
    Object.prototype.hasOwnProperty.call(schemaOrOptions as object, 'aliases') ||
    Object.prototype.hasOwnProperty.call(schemaOrOptions as object, 'includeInternalKeys') ||
    Object.prototype.hasOwnProperty.call(schemaOrOptions as object, 'schema')
  );

  const options = (isOptions ? (schemaOrOptions as BindOptions<T>) : { schema: schemaOrOptions as SchemaLike<T> }) as BindOptions<T>;
  const schema = options.schema;
  const aliases = options.aliases ?? defaultAliases;
  const includeInternalKeys = options.includeInternalKeys ?? false;
  const { publicToInternal, internalToPublic } = buildAliasMaps(aliases);

  // Cache structural methods to maintain reference equality
  const cachedMethods = new Map<string, any>();

  return new Proxy({} as BindedVertex<T>, {
    get(_target, prop: string | symbol) {
      // Handle useTransient method
      if (prop === RESERVED_METHOD_USE_TRANSIENT) {
        return (fn: (t: T) => void) => {
          // Create a transient proxy (not yet implemented - will need writes: 'transient' support)
          const transientProxy = new Proxy({} as T, {
            get(_t, p: string | symbol) {
              if (typeof p !== 'string') return undefined;
              const rule = publicToInternal.get(p);
              if (rule) {
                const raw = tree.getVertexProperty(id, rule.internalKey);
                return rule.toPublic ? rule.toPublic(raw as unknown) : raw;
              }
              return tree.getVertexProperty(id, p);
            },
            set(_t, p: string | symbol, value: unknown) {
              if (typeof p !== 'string') return true;

              // Validation (same as persistent)
              if (schema?.shape && schema.shape[p]) {
                const field = schema.shape[p];
                if (field.safeParse) {
                  const res = field.safeParse(value);
                  if (!res.success) throw new Error(`Invalid value for ${String(p)}`);
                  value = (res as any).data ?? value;
                }
              } else if (schema?.safeParse) {
                const next = { ...toPublicObject(tree, id, internalToPublic), [p]: value } as unknown;
                const res = schema.safeParse(next);
                if (!res.success) throw new Error(`Invalid value for ${String(p)}`);
                const parsed = (res as any).data as Record<string, unknown>;
                if (parsed && Object.prototype.hasOwnProperty.call(parsed, p)) {
                  value = parsed[p];
                }
              }

              // Apply alias mapping and use setTransientVertexProperty
              const rule = publicToInternal.get(p);
              if (rule) {
                const converted = rule.toInternal ? rule.toInternal(value) : value;
                tree.setTransientVertexProperty(id, rule.internalKey, converted as any);
                return true;
              }

              tree.setTransientVertexProperty(id, p, value as any);
              return true;
            },
            deleteProperty(_t, p: string | symbol) {
              if (typeof p !== 'string') return true;
              const rule = publicToInternal.get(p);
              if (rule) {
                tree.setTransientVertexProperty(id, rule.internalKey, undefined as any);
                return true;
              }
              tree.setTransientVertexProperty(id, p, undefined as any);
              return true;
            },
          });
          fn(transientProxy);
        };
      }

      // Handle commitTransients(): promote existing transient overlays to persistent values
      if (prop === RESERVED_METHOD_COMMIT_TRANSIENTS) {
        return () => {
          // Enumerate all keys visible with transient overlay applied
          const entries = tree.getVertexProperties(id);

          // Build a public object snapshot for whole-object validation when needed
          const currentPublic = schema?.safeParse ? toPublicObject(tree, id, internalToPublic) : undefined;

          for (const { key: internalKey, value: overlayValue } of entries) {
            // Compare with underlying persistent value to detect transient overlay
            const persistentValue = tree.getVertexProperty(id, internalKey, false);
            if (overlayValue === persistentValue) continue;

            // Resolve public key and value for validation
            const aliasRule = internalToPublic.get(internalKey);
            const publicKey = aliasRule ? aliasRule.publicKey : internalKey;
            const publicValue = aliasRule && aliasRule.toPublic ? aliasRule.toPublic(overlayValue as unknown) : overlayValue;

            let valueToPersistInternal: unknown = overlayValue;

            // Field-level validation
            if (schema?.shape && schema.shape[publicKey]) {
              const field = schema.shape[publicKey]!;
              if (field.safeParse) {
                const res = field.safeParse(publicValue);
                if (!res.success) throw new Error(`Invalid value for ${String(publicKey)}`);
                const coerced = (res as any).data;
                const maybeInternal = aliasRule && aliasRule.toInternal ? aliasRule.toInternal(coerced) : coerced;
                valueToPersistInternal = maybeInternal;
              }
            } else if (schema?.safeParse && currentPublic) {
              const nextPublic = { ...currentPublic, [publicKey]: publicValue } as unknown;
              const res = schema.safeParse(nextPublic);
              if (!res.success) throw new Error('Invalid values for commitTransients');
              const parsed = (res as any).data as Record<string, unknown>;
              const parsedPublic = Object.prototype.hasOwnProperty.call(parsed, publicKey) ? parsed[publicKey] : publicValue;
              const maybeInternal = aliasRule && aliasRule.toInternal ? aliasRule.toInternal(parsedPublic) : parsedPublic;
              valueToPersistInternal = maybeInternal;
            }

            // Persist using internal key
            tree.setVertexProperty(id, internalKey, valueToPersistInternal as any);
          }
        };
      }

      // Handle vertex properties
      if (typeof prop === 'string') {
        if (prop === '$id') return id;
        if (prop === '$parentId') return tree.getVertex(id)?.parentId ?? null;
        if (prop === '$parent') {
          const vertex = tree.getVertex(id);
          return vertex?.parent;
        }
        if (prop === '$children') return tree.getChildren(id);
        if (prop === '$childrenIds') return tree.getChildrenIds(id);

        // Handle vertex methods (cached for reference equality)
        if (prop === '$moveTo') {
          if (!cachedMethods.has(prop)) {
            cachedMethods.set(prop, (parent: any) => {
              // parent can be Vertex or BindedVertex - extract ID
              const parentId = typeof parent === 'object' && parent !== null ? (parent.id || parent.$id) : parent;
              tree.moveVertex(id, parentId);
            });
          }
          return cachedMethods.get(prop);
        }
        if (prop === '$delete') {
          if (!cachedMethods.has(prop)) {
            cachedMethods.set(prop, () => tree.deleteVertex(id));
          }
          return cachedMethods.get(prop);
        }
        if (prop === '$observe') {
          if (!cachedMethods.has(prop)) {
            cachedMethods.set(prop, (listener: (events: any[]) => void) => tree.observe(id, listener));
          }
          return cachedMethods.get(prop);
        }
        if (prop === '$observeChildren') {
          if (!cachedMethods.has(prop)) {
            cachedMethods.set(prop, (listener: (children: any[]) => void) => {
              return tree.observe(id, (events: any[]) => {
                if (events.some((e: any) => e.type === 'children')) {
                  listener(tree.getChildren(id));
                }
              });
            });
          }
          return cachedMethods.get(prop);
        }
        if (prop === '$newChild') {
          if (!cachedMethods.has(prop)) {
            cachedMethods.set(prop, (props?: Record<string, any> | object | null) => {
              const vertex = tree.getVertex(id);
              return vertex?.newChild(props);
            });
          }
          return cachedMethods.get(prop);
        }
        if (prop === '$newNamedChild') {
          if (!cachedMethods.has(prop)) {
            cachedMethods.set(prop, (name: string, props?: Record<string, any> | object | null) => {
              const vertex = tree.getVertex(id);
              return vertex?.newNamedChild(name, props);
            });
          }
          return cachedMethods.get(prop);
        }
      }

      if (typeof prop !== 'string') return undefined;
      const rule = publicToInternal.get(prop);
      if (rule) {
        const raw = tree.getVertexProperty(id, rule.internalKey);
        return rule.toPublic ? rule.toPublic(raw as unknown) : raw;
      }
      // Fallback to direct property access
      return tree.getVertexProperty(id, prop);
    },
    set(_target, prop: string | symbol, value: unknown) {
      if (typeof prop !== 'string') return true;
      // Guard reserved method names from being persisted as properties
      if (prop === RESERVED_METHOD_USE_TRANSIENT || prop === RESERVED_METHOD_COMMIT_TRANSIENTS) {
        return true;
      }
      // Guard vertex properties from being set
      if (VERTEX_PROPS.includes(prop as any)) {
        return true;
      }
      // Guard vertex methods from being set
      if (VERTEX_METHODS.includes(prop as any)) {
        return true;
      }

      // Prefer field-level validation when available (validate public keys)
      if (schema?.shape && schema.shape[prop]) {
        const field = schema.shape[prop];
        if (field.safeParse) {
          const res = field.safeParse(value);
          if (!res.success) throw new Error(`Invalid value for ${String(prop)}`);
          value = (res as any).data ?? value;
        }
      } else if (schema?.safeParse) {
        // Fallback to whole-object validation when field schema is unavailable
        const next = { ...toPublicObject(tree, id, internalToPublic), [prop]: value } as unknown;
        const res = schema.safeParse(next);
        if (!res.success) throw new Error(`Invalid value for ${String(prop)}`);
        // If schema coerces/transforms, apply coerced value
        const parsed = (res as any).data as Record<string, unknown>;
        if (parsed && Object.prototype.hasOwnProperty.call(parsed, prop)) {
          value = parsed[prop];
        }
      }

      // Apply alias mapping (convert public key/value to internal)
      const rule = publicToInternal.get(prop);
      if (rule) {
        const converted = rule.toInternal ? rule.toInternal(value) : value;
        tree.setVertexProperty(id, rule.internalKey, converted as any);
        return true;
      }

      tree.setVertexProperty(id, prop, value as any);
      return true;
    },
    deleteProperty(_target, prop: string | symbol) {
      if (typeof prop !== 'string') return true;
      // Guard reserved method names
      if (prop === RESERVED_METHOD_USE_TRANSIENT || prop === RESERVED_METHOD_COMMIT_TRANSIENTS) {
        return true;
      }
      // Guard vertex properties
      if (VERTEX_PROPS.includes(prop as any)) {
        return true;
      }
      // Guard vertex methods
      if (VERTEX_METHODS.includes(prop as any)) {
        return true;
      }
      const rule = publicToInternal.get(prop);
      if (rule) {
        tree.setVertexProperty(id, rule.internalKey, undefined as any);
        return true;
      }
      tree.setVertexProperty(id, prop, undefined as any);
      return true;
    },
    has(_target, prop: string | symbol) {
      if (typeof prop !== 'string') return false;
      // Expose public keys by default when schema is present
      if (schema?.shape && Object.prototype.hasOwnProperty.call(schema.shape, prop)) return true;
      if (includeInternalKeys) {
        // Allow direct checks for internal keys when opted-in
        return publicToInternal.has(prop) || internalToPublic.has(prop);
      }
      return false;
    },
    ownKeys() {
      const keys = new Set<string>();
      for (const k of Object.keys(schema?.shape ?? {})) keys.add(k);
      if (includeInternalKeys) {
        for (const rule of aliases) keys.add(rule.internalKey);
      }
      return Array.from(keys);
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true } as PropertyDescriptor;
    },
  });
}