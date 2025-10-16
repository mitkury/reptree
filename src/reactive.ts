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

  // =============================================================================
  // SECTION 1: Setup base object and determine which properties to define
  // =============================================================================
  
  const obj: any = {};
  let isObserverUpdate = false;

  // Determine which properties need getters/setters (schema properties + aliases)
  const propsToDefine = new Set<string>();
  if (schema?.shape) {
    Object.keys(schema.shape).forEach(key => propsToDefine.add(key));
    aliases.forEach(alias => propsToDefine.add(alias.publicKey));
  }

  // Initialize local storage with values from CRDT
  const localValues = new Map<string, unknown>();
  propsToDefine.forEach(publicKey => {
    const rule = publicToInternal.get(publicKey);
    const internalKey = rule?.internalKey ?? publicKey;
    const rawValue = tree.getVertexProperty(id, internalKey);
    const publicValue = rule?.toPublic ? rule.toPublic(rawValue as unknown) : rawValue;
    localValues.set(publicKey, publicValue);
  });

  // =============================================================================
  // SECTION 2: Define getters/setters for schema properties
  // =============================================================================
  
  propsToDefine.forEach(publicKey => {
    const rule = publicToInternal.get(publicKey);
    const storageKey = `_${publicKey}_value`; // Svelte-friendly storage key
    
    // Initialize on obj for Svelte to track
    obj[storageKey] = localValues.get(publicKey);
    
    Object.defineProperty(obj, publicKey, {
      get: function() {
        // Read from CRDT including transients, then cache locally
        const internalKey = rule?.internalKey ?? publicKey;
        const rawValue = tree.getVertexProperty(id, internalKey, true); // Include transients!
        const publicValue = rule?.toPublic ? rule.toPublic(rawValue as unknown) : rawValue;
        
        // Update local storage for Svelte tracking
        if (this[storageKey] !== publicValue) {
          this[storageKey] = publicValue;
        }
        
        return publicValue;
      },
      set: function(value: unknown) {
        // Validate using schema
        if (schema?.shape && schema.shape[publicKey]) {
          const field = schema.shape[publicKey]!;
          if (field.safeParse) {
            const res = field.safeParse(value);
            if (!res.success) throw new Error(`Invalid value for ${publicKey}`);
            value = (res as any).data;
          }
        }
        
        // Update local storage (Svelte tracks this!)
        this[storageKey] = value;
        
        // Sync to CRDT (unless this is from observer to prevent infinite loop)
        if (!isObserverUpdate) {
          const internalKey = rule?.internalKey ?? publicKey;
          const internalValue = rule?.toInternal ? rule.toInternal(value) : value;
          tree.setVertexProperty(id, internalKey, internalValue as any);
        }
      },
      enumerable: true,
      configurable: true
    });
  });

  // =============================================================================
  // SECTION 3: Define $ properties and methods (vertex API)
  // =============================================================================
  
  const cachedMethods = new Map<string, any>();
  const getCachedMethod = (name: string, factory: () => any) => {
    if (!cachedMethods.has(name)) {
      cachedMethods.set(name, factory());
    }
    return cachedMethods.get(name);
  };

  Object.defineProperties(obj, {
    $id: {
      get: () => id,
      set: () => {}, // No-op setter (silently ignore)
      enumerable: false,
      configurable: true
    },
    $parentId: {
      get: () => tree.getVertex(id)?.parentId ?? null,
      set: () => {}, // No-op setter
      enumerable: false,
      configurable: true
    },
    $parent: {
      get: () => tree.getVertex(id)?.parent,
      set: () => {}, // No-op setter
      enumerable: false,
      configurable: true
    },
    $children: {
      get: () => tree.getChildren(id),
      set: () => {}, // No-op setter
      enumerable: false,
      configurable: true
    },
    $childrenIds: {
      get: () => tree.getChildrenIds(id),
      set: () => {}, // No-op setter
      enumerable: false,
      configurable: true
    },
    $moveTo: {
      get: () => getCachedMethod('$moveTo', () => (parent: any) => {
        const parentId = typeof parent === 'object' && parent !== null ? (parent.id || parent.$id) : parent;
        tree.moveVertex(id, parentId);
      }),
      set: () => {}, // No-op setter
      enumerable: false,
      configurable: true
    },
    $delete: {
      get: () => getCachedMethod('$delete', () => () => tree.deleteVertex(id)),
      set: () => {}, // No-op setter
      enumerable: false,
      configurable: true
    },
    $observe: {
      get: () => getCachedMethod('$observe', () => (listener: (events: any[]) => void) => tree.observe(id, listener)),
      set: () => {}, // No-op setter
      enumerable: false,
      configurable: true
    },
    $observeChildren: {
      get: () => getCachedMethod('$observeChildren', () => (listener: (children: any[]) => void) => {
        return tree.observe(id, (events: any[]) => {
          if (events.some((e: any) => e.type === 'children')) {
            listener(tree.getChildren(id));
          }
        });
      }),
      set: () => {}, // No-op setter
      enumerable: false,
      configurable: true
    },
    $newChild: {
      get: () => getCachedMethod('$newChild', () => (props?: Record<string, any> | object | null) => {
        const vertex = tree.getVertex(id);
        return vertex?.newChild(props);
      }),
      set: () => {}, // No-op setter
      enumerable: false,
      configurable: true
    },
    $newNamedChild: {
      get: () => getCachedMethod('$newNamedChild', () => (name: string, props?: Record<string, any> | object | null) => {
        const vertex = tree.getVertex(id);
        return vertex?.newNamedChild(name, props);
      }),
      set: () => {}, // No-op setter
      enumerable: false,
      configurable: true
    },
    useTransient: {
      value: function(fn: (t: any) => void) {
        // Create a transient proxy that writes transient properties
        const transientProxy = new Proxy({} as any, {
          set(_, prop: string | symbol, value: unknown) {
            if (typeof prop === 'string') {
              // Check if it's an alias
              const rule = publicToInternal.get(prop);
              const internalKey = rule?.internalKey ?? prop;
              const internalValue = rule?.toInternal ? rule.toInternal(value) : value;
              tree.setTransientVertexProperty(id, internalKey, internalValue as any);
            }
            return true;
          },
          get(_, prop: string | symbol) {
            if (typeof prop !== 'string') return undefined;
            // Read from transient or persistent
            const rule = publicToInternal.get(prop);
            const internalKey = rule?.internalKey ?? prop;
            const rawValue = tree.getVertexProperty(id, internalKey, true);
            return rule?.toPublic ? rule.toPublic(rawValue as unknown) : rawValue;
          }
        });
        fn(transientProxy);
      },
      enumerable: false,
      configurable: true
    },
    commitTransients: {
      value: function() {
        tree.commitTransients(id);
      },
      enumerable: false,
      configurable: true
    },
    equals: {
      value: function(other: any) {
        if (other && typeof other === 'object' && '$id' in other) {
          return other.$id === id;
        }
        return obj === other;
      },
      enumerable: false,
      configurable: true
    }
  });

  // =============================================================================
  // SECTION 4: Observer - sync CRDT updates to local storage
  // =============================================================================
  
  tree.observe(id, (events) => {
    isObserverUpdate = true;
    for (const e of events) {
      if (e.type === 'property') {
        const propEvent = e as any; // VertexPropertyChangeEvent
        const rule = internalToPublic.get(propEvent.key);
        if (rule) {
          const publicKey = rule.publicKey;
          const publicValue = rule.toPublic ? rule.toPublic(propEvent.value as unknown) : propEvent.value;
          const storageKey = `_${publicKey}_value`;
          if (storageKey in obj) {
            obj[storageKey] = publicValue;
          }
        }
      }
    }
    isObserverUpdate = false;
  });

  // =============================================================================
  // SECTION 5: Return strategy - schema vs non-schema vertices
  // =============================================================================
  
  // Schema vertices: return plain object for Svelte compatibility
  // This allows Svelte's $state() and $derived() to work correctly
  // Trade-off: delete operator doesn't work (use assignment to undefined instead)
  if (schema) {
    return obj as BindedVertex<T>;
  }

  // Non-schema vertices: wrap in Proxy for dynamic property access
  const proxy = new Proxy(obj, {
    get(target, prop: string | symbol) {
      if (typeof prop !== 'string') {
        return target[prop as any];
      }
      if (prop in target || prop.startsWith('$') || prop === 'equals') {
        return target[prop as any];
      }
      
      // Check if this is an alias
      const rule = publicToInternal.get(prop);
      if (rule) {
        const internalKey = rule.internalKey;
        const rawValue = tree.getVertexProperty(id, internalKey);
        const result = rule.toPublic ? rule.toPublic(rawValue as unknown) : rawValue;
        return result;
      }
      
      // Dynamic property - read from CRDT
      const rawValue = tree.getVertexProperty(id, prop);
      return rawValue;
    },
    
    set(target, prop: string | symbol, value: unknown) {
      if (typeof prop !== 'string') {
        target[prop as any] = value;
        return true;
      }

      // If it's a defined property with a setter (schema props), use it
      const descriptor = Object.getOwnPropertyDescriptor(target, prop);
      if (descriptor && descriptor.set) {
        target[prop as any] = value;
        return true;
      }
      
      // Check if this is an alias
      const rule = publicToInternal.get(prop);
      if (rule) {
        const internalKey = rule.internalKey;
        const internalValue = rule.toInternal ? rule.toInternal(value) : value;
        tree.setVertexProperty(id, internalKey, internalValue as any);
        return true;
      }

      // Dynamic property - write to CRDT directly (don't create on target!)
      tree.setVertexProperty(id, prop, value as any);
      return true;
    },
    
    deleteProperty(target, prop: string | symbol) {
      if (typeof prop !== 'string') {
        delete target[prop as any];
        return true;
      }
      
      // For schema properties, also clear the storage key
      const storageKey = `_${prop}_value`;
      if (storageKey in target) {
        delete target[storageKey];
      }
      
      // Delete the property descriptor if it exists
      if (prop in target) {
        delete target[prop as any];
      }
      
      // Check if this is an alias or schema property - clear from CRDT
      const rule = publicToInternal.get(prop);
      if (rule) {
        tree.setVertexProperty(id, rule.internalKey, undefined as any);
        return true;
      }
      
      // Dynamic property - clear from CRDT
      tree.setVertexProperty(id, prop, undefined as any);
      return true;
    }
  });

  return proxy as BindedVertex<T>;
}
