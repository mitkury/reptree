import type { RepTree } from './RepTree';

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
  useTransient(fn: (t: T) => void): void;
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

// Symbol for useTransient method to avoid property collisions
const USE_TRANSIENT = Symbol('useTransient');

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

  return new Proxy({} as BindedVertex<T>, {
    get(_target, prop: string | symbol) {
      // Handle useTransient method
      if (prop === USE_TRANSIENT || prop === 'useTransient') {
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