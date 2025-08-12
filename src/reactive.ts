import type { RepTree } from './RepTree';

export type FieldSchemaLike = {
  safeParse?: (input: unknown) => { success: true; data: unknown } | { success: false };
};

export type SchemaLike<T> = {
  safeParse?: (input: unknown) => { success: true; data: T } | { success: false };
  parse?: (input: unknown) => T;
  shape?: Record<string, FieldSchemaLike>;
};

function toObject(tree: RepTree, id: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const { key, value } of tree.getVertexProperties(id)) obj[key] = value as unknown;
  return obj;
}

/**
 * Returns a live object that proxies reads/writes to a vertex.
 * - Reads reflect the latest CRDT state.
 * - Writes persist to the CRDT.
 * - If a schema is provided, writes are validated. If a field schema exists in `schema.shape`, field-level validation is applied.
 */
export function bindVertex<T extends Record<string, unknown>>(
  tree: RepTree,
  id: string,
  schema?: SchemaLike<T>
): T {
  return new Proxy({} as T, {
    get(_target, prop: string | symbol) {
      if (typeof prop !== 'string') return undefined;
      return tree.getVertexProperty(id, prop);
    },
    set(_target, prop: string | symbol, value: unknown) {
      if (typeof prop !== 'string') return true;

      // Prefer field-level validation when available
      if (schema?.shape && schema.shape[prop]) {
        const field = schema.shape[prop];
        if (field.safeParse) {
          const res = field.safeParse(value);
          if (!res.success) throw new Error(`Invalid value for ${String(prop)}`);
          value = (res as any).data ?? value;
        }
      } else if (schema?.safeParse) {
        // Fallback to whole-object validation when field schema is unavailable
        const next = { ...toObject(tree, id), [prop]: value } as unknown;
        const res = schema.safeParse(next);
        if (!res.success) throw new Error(`Invalid value for ${String(prop)}`);
        // If schema coerces/transforms, apply coerced value
        const parsed = (res as any).data as Record<string, unknown>;
        if (parsed && Object.prototype.hasOwnProperty.call(parsed, prop)) {
          value = parsed[prop];
        }
      }

      tree.setVertexProperty(id, prop, value as any);
      return true;
    },
    deleteProperty(_target, prop: string | symbol) {
      if (typeof prop !== 'string') return true;
      tree.setVertexProperty(id, prop, undefined as any);
      return true;
    },
    has(_target, prop: string | symbol) {
      if (typeof prop !== 'string') return false;
      return !!schema?.shape && Object.prototype.hasOwnProperty.call(schema.shape, prop);
    },
    ownKeys() {
      return Object.keys(schema?.shape ?? {});
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true } as PropertyDescriptor;
    },
  });
}