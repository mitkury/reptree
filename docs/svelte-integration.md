# Svelte 5 Integration

## How It Works

RepTree's `BindedVertex` is designed to work seamlessly with Svelte 5's reactivity system.

### Our Implementation

`BindedVertex` is a **Proxy** that:
- Intercepts property reads → fetches from CRDT
- Intercepts property writes → persists to CRDT
- Provides `$`-prefixed vertex methods/properties
- Fires observers when data changes (~33ms batched)

### Svelte 5's Reactivity

Svelte 5 uses **runes** for state management:
- `$state(obj)` → wraps objects in a Proxy to track changes
- `$derived()` → creates computed values
- `$effect()` → runs side effects when dependencies change

### Compatibility

✅ **It works!** Here's why:

1. **Double Proxy is fine**: Svelte's Proxy wraps our Proxy, creating a chain that works correctly
2. **Property access**: Both proxies properly forward get/set operations
3. **Change detection**: You can use our `$observe()` method to trigger Svelte re-renders
4. **Method stability**: Our cached methods maintain reference equality (important for Svelte)
5. **`equals()` method**: We provide the `equals()` method that Svelte 5's reactivity system needs

### The Fix

The error `source2.equals is not a function` was fixed by adding an `equals()` method to `BindedVertex`:

```ts
person.equals(other) // true if same vertex, false otherwise
```

This method is used internally by Svelte 5's reactivity system to check if state has changed.

## Usage Pattern

### Basic Example

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

  // ✅ Use $state() - BindedVertex is a plain object that Svelte can track
  let person = $state(v.bind(Person));
</script>

<input bind:value={person.name} />
<input type="number" bind:value={person.age} />

<!-- Vertex methods work too -->
<p>Children: {person.$children.length}</p>
<button onclick={() => person.$newNamedChild('New', {})}>Add Child</button>
```

### With Observations (Recommended)

For real-time updates from other peers, use `$observe()` with Svelte's `$effect()`:

```svelte
<script lang="ts">
  import { RepTree } from 'reptree';
  import { z } from 'zod';

  const tree = new RepTree('peer1');
  const root = tree.createRoot();
  const v = root.newChild();

  const Person = z.object({ 
    name: z.string(), 
    age: z.number() 
  });

  const person = v.bind(Person);

  // Create reactive snapshot that updates when CRDT changes
  let snapshot = $state({ name: person.name, age: person.age });

  // Observe changes from other peers
  $effect(() => {
    const unobserve = person.$observe(() => {
      // Update snapshot when CRDT changes
      snapshot = { name: person.name, age: person.age };
    });

    return () => unobserve();
  });
</script>

<p>Name: {snapshot.name}</p>
<p>Age: {snapshot.age}</p>

<button onclick={() => { person.name = 'Updated'; }}>
  Update Name
</button>
```

### Using Vertex Methods

All `$`-prefixed methods work seamlessly:

```svelte
<script lang="ts">
  const tree = new RepTree('peer1');
  const root = tree.createRoot();
  const folder = root.newChild().bind();

  function addFile() {
    const file = folder.$newNamedChild('new-file.txt', { 
      size: 0, 
      type: 'text' 
    });
    console.log('Created file:', file.id);
  }
</script>

<button onclick={addFile}>Add File</button>

<ul>
  {#each folder.$children as child}
    <li>{child.name}</li>
  {/each}
</ul>
```

## Key Considerations

### 1. Using $state()

**Recommended pattern** - wrap your bound vertex in `$state()`:

```svelte
<script>
  let person = $state(v.bind(Person));
</script>

<input bind:value={person.name} />
```

This allows Svelte to track the bound vertex and re-render when properties change. While our Proxy handles CRDT persistence, `$state()` ensures Svelte's reactivity system is aware of changes.

### 2. Observer Batching

RepTree batches change events (~33ms intervals). For immediate UI updates when using `$state()`:

```svelte
<script>
  let person = $state(v.bind(Person));

  // This triggers UI update through Svelte's reactivity
  person.name = 'Alice';

  // Observer fires ~33ms later (useful for multi-peer sync)
  $effect(() => {
    const unobserve = person.$observe((events) => {
      console.log('CRDT updated from peers:', events);
    });
    return () => unobserve();
  });
</script>
```

### 3. Method Reference Equality

Our methods maintain reference equality, so Svelte won't re-render unnecessarily:

```svelte
<script>
  const folder = v.bind();

  // These are the same function reference
  const move1 = folder.$moveTo;
  const move2 = folder.$moveTo;
  console.log(move1 === move2); // true
</script>
```

## Testing

See `__tests__/svelte-integration.test.ts` for comprehensive tests demonstrating:
- Property read/write through wrapped state
- Observer-based re-rendering
- Vertex methods through state
- Multiple BindedVertex instances
- Method reference equality

## Best Practices

1. **Use `$state()` with bound vertices** - `let person = $state(v.bind(Person))`
2. **Use `$observe()`** for peer updates - integrate with `$effect()`
3. **Leverage vertex methods** - `$children`, `$parent`, etc. work great in templates
4. **Validate with Zod** - type-safe reactive vertices

## Example: Multi-User File Tree

```svelte
<script lang="ts">
  import { RepTree } from 'reptree';
  import { z } from 'zod';

  const tree = new RepTree('user-' + Math.random());
  const root = tree.createRoot();

  const Folder = z.object({
    name: z.string(),
    type: z.literal('folder')
  });

  // ✅ Use $state() directly with bound vertex
  let rootFolder = $state(root.bind(Folder));
  rootFolder.name = 'My Files';
  rootFolder.type = 'folder';

  // Track children reactively
  let children = $state(rootFolder.$children);

  // Update when CRDT changes (from other users)
  $effect(() => {
    const unobserve = rootFolder.$observeChildren((updated) => {
      children = updated;
    });
    return () => unobserve();
  });

  function addFolder() {
    rootFolder.$newNamedChild('New Folder', { 
      name: 'New Folder',
      type: 'folder' 
    });
  }
</script>

<h1>{rootFolder.name}</h1>

<button onclick={addFolder}>Add Folder</button>

<ul>
  {#each children as child}
    <li>{child.name}</li>
  {/each}
</ul>
```

## Conclusion

RepTree's `BindedVertex` works seamlessly with Svelte 5's reactivity system. The Proxy-based implementation is compatible with Svelte's `$state()`, and our `$observe()` method integrates perfectly with `$effect()` for real-time collaborative features.

