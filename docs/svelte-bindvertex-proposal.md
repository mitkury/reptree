# Proposal: Svelte-Compatible `BindedVertex`

## Current Problem
- `BindedVertex` uses getters/setters or Proxy traps
- Svelte's `$state()` can't track these for `$derived()` reactivity
- Writing to properties doesn't trigger Svelte's fine-grained updates

## Solution: Plain Properties + Sync Proxy

### Core Idea
1. **Plain properties** on a target object (Svelte can instrument these)
2. **Proxy wrapper** that intercepts writes and syncs to CRDT
3. **Observer** updates properties via the proxy (so Svelte sees changes)
4. **Update flag** prevents observer→CRDT echo (avoids infinite loop)

### Implementation

```ts
function bindVertex<T>(tree: RepTree, id: string, options: BindOptions<T>) {
  const { schema, aliases = defaultAliases } = options;
  const { publicToInternal, internalToPublic } = buildAliasMaps(aliases);
  
  // Plain object with current CRDT values as plain properties
  const obj: any = {};
  let isObserverUpdate = false;
  
  // Initialize properties from CRDT
  for (const { key, value } of tree.getVertexProperties(id)) {
    const publicKey = internalToPublic.get(key)?.publicKey ?? key;
    const publicValue = internalToPublic.get(key)?.toPublic?.(value) ?? value;
    obj[publicKey] = publicValue;
  }
  
  // Add schema keys even if not in CRDT yet
  if (schema?.shape) {
    for (const key of Object.keys(schema.shape)) {
      if (!(key in obj)) obj[key] = undefined;
    }
  }
  
  // Proxy: intercepts writes, validates, syncs to CRDT
  const proxy = new Proxy(obj, {
    set(target, prop, value) {
      // Validate
      if (schema?.shape?.[prop]?.safeParse) {
        const res = schema.shape[prop].safeParse(value);
        if (!res.success) throw new Error(`Invalid ${String(prop)}`);
        value = res.data;
      }
      
      // Update plain property (Svelte tracks this!)
      target[prop] = value;
      
      // Sync to CRDT (except when observer is updating)
      if (!isObserverUpdate) {
        const rule = publicToInternal.get(prop);
        const internalKey = rule?.internalKey ?? prop;
        const internalValue = rule?.toInternal?.(value) ?? value;
        tree.setVertexProperty(id, internalKey, internalValue);
      }
      
      return true;
    }
  });
  
  // Observer: syncs CRDT updates to proxy
  tree.observe(id, (events) => {
    isObserverUpdate = true;
    for (const e of events) {
      if (e.type === 'property') {
        const rule = internalToPublic.get(e.key);
        const publicKey = rule?.publicKey ?? e.key;
        const publicValue = rule?.toPublic?.(e.value) ?? e.value;
        proxy[publicKey] = publicValue; // Updates via proxy, Svelte sees it
      }
    }
    isObserverUpdate = false;
  });
  
  // Add $ methods as non-enumerable properties
  Object.defineProperties(obj, {
    $id: { get: () => id, enumerable: false },
    $observe: { value: (fn) => tree.observe(id, fn), enumerable: false },
    // ... other $ methods
  });
  
  return proxy as BindedVertex<T>;
}
```

### How It Works

**User types "Alice":**
```
user input → proxy.name = 'Alice'
          → obj.name = 'Alice' (Svelte sees this ✓)
          → tree.setVertexProperty(id, '_n', 'Alice') ✓
```

**Remote peer updates:**
```
CRDT update → observer fires
           → isObserverUpdate = true
           → proxy.name = 'Bob'
           → obj.name = 'Bob' (Svelte sees this ✓)
           → skips tree.setVertexProperty (flag is true) ✓
           → isObserverUpdate = false
```

### Benefits
- ✅ Works with `$state(person)` - plain properties are trackable
- ✅ `$derived()` reacts to changes - Svelte instruments plain properties
- ✅ Two-way sync - local writes → CRDT, CRDT updates → local
- ✅ No infinite loops - flag prevents observer echo
- ✅ Framework agnostic - any framework that instruments plain objects works

### What Changes
- Replace current getter/setter approach with plain properties + Proxy
- Single code path for all property updates (via proxy)
- Clean separation: Proxy = validation + CRDT sync, Observer = CRDT → local

### Usage Example

```svelte
<script lang="ts">
  import { RepTree } from 'reptree';
  import { z } from 'zod';

  const tree = new RepTree('peer1');
  const root = tree.createRoot();
  const v = root.newChild();

  const Person = z.object({ 
    name: z.string(), 
    age: z.number().int().min(0) 
  });

  // ✅ Use regular $state() - works with $derived!
  let person = $state(v.bind(Person));
  
  // ✅ $derived reacts to changes
  let greeting = $derived(`Hello, ${person.name || 'stranger'}!`);
</script>

<input bind:value={person.name} />
<input type="number" bind:value={person.age} />
<p>{greeting}</p>
```

### Edge Cases Handled
- **Dynamic properties**: New keys can be added at runtime
- **Schema validation**: Field-level and whole-object validation preserved
- **Alias transformations**: `name` ↔ `_n`, `createdAt` ↔ `_c` with Date conversion
- **Concurrent updates**: Observer batching (33ms) means multiple updates come together
- **$ methods**: Non-enumerable, read-only, don't pollute property space

