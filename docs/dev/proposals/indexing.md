# Indexing in RepTree

RepTree can support local secondary indexes to enable fast queries over nodes and properties. Indexes are maintained from CRDT events and are local to the replica. In the current in-memory tree they can be simple JS maps; in the big-tree storage model they should be backed by an `IndexStore` so queries do not require materializing every node.

## API
```ts
import { RepTree, Node } from 'reptree'

type IndexType = 'property' | 'fulltext' | 'custom'

interface IndexOptions<K> {
  name: string
  type: IndexType
  // property index: key in node properties
  property?: string
  // full-text index: tokenizer for property values
  tokenizer?: (s: string) => string[]
  // custom index: map a node to one or more keys
  mapKey?: (v: Node) => K | K[]
  // treat returned array or property values as multi-valued
  multiValued?: boolean
}

interface IndexStore<K = unknown> {
  put(indexName: string, key: K, nodeId: string): Promise<void>
  delete(indexName: string, key: K, nodeId: string): Promise<void>
  query(indexName: string, key: K): Promise<string[]>
  clear(indexName: string): Promise<void>
}

declare module 'reptree' {
  interface RepTree {
    createIndex<K>(opts: IndexOptions<K>): void
    dropIndex(name: string): void
    hasIndex(name: string): boolean
    listIndices(): string[]
    queryIndex<K>(name: string, key: K): Node[]
    /** Subscribe to index update events */
    observeIndex<K>(
      name: string,
      listener: (v: Node, action: 'add' | 'remove', key: K) => void
    ): () => void
    query(fn: (v: Node) => boolean): Node[]
  }
}
```

The API above is the synchronous in-memory shape. In the big-tree mode described in `big-trees.md`, methods that may hit storage become async:

```ts
interface AsyncIndexApi {
  createIndex<K>(opts: IndexOptions<K>): Promise<void>
  queryIndex<K>(name: string, key: K): Promise<Node[]>
  query(fn: (v: Node) => boolean): AsyncIterable<Node>
}
```

### Full-text Index

To create a full-text index, set `type: 'fulltext'`, specify the `property` to index, and provide a `tokenizer` function that splits text into tokens. Tokens are indexed as keys; use `multiValued: true` to index all tokens per node.

```ts
tree.createIndex<string>({
  name: 'contentsFTS',
  type: 'fulltext',
  property: 'content',
  tokenizer: text => text.toLowerCase().match(/\w+/g) || [],
  multiValued: true
})
```

Then query by token:

```ts
tree.queryIndex('contentsFTS', 'replication')
```

### Custom Index

A custom index maps each node to one or more keys via `mapKey`. It can return a single key or an array of keys. Set `multiValued: true` when mapping to multiple keys.

```ts
// Single-valued custom index
tree.createIndex<number>({
  name: 'statusIndex',
  type: 'custom',
  mapKey: v => v.props.status as number
})

// Multi-valued custom index (e.g., tags or roles)
tree.createIndex<string>({
  name: 'roleIndex',
  type: 'custom',
  mapKey: v => (v.props.roles as string[]) || [],
  multiValued: true
})
```

Query by key:

```ts
tree.queryIndex('statusIndex', 200)
```

## Usage Example
```ts
const tree = new RepTree('peer1')
const root = tree.createRoot()
root.props.name = 'Projects'
root.newNamedChild('Docs')

// a) property index on "name"
tree.createIndex<string>({
  name: 'byName',
  type: 'property',
  property: 'name'
})
const docs = tree.queryIndex('byName', 'Docs')

// b) full-text index on "content"
tree.createIndex<string>({
  name: 'fts',
  type: 'fulltext',
  property: 'content',
  tokenizer: s => s.toLowerCase().split(/\W+/)
})
const hits = tree.queryIndex('fts', 'replication')

// c) custom index
tree.createIndex<number>({
  name: 'byOwnerId',
  type: 'custom',
  mapKey: v => v.props.ownerId || 0
})
const mine = tree.queryIndex('byOwnerId', 123)
```

## Implementation Notes
- `createIndex` seeds an index from existing nodes. In memory mode this scans `TreeState`; in big-tree mode this scans `NodeStore` or replays `PropLogStore`.
- Subscribes to CRDT events (`op`, `propSet`) or fold-worker patches to keep indexes up-to-date.
- `queryIndex` first asks the index for matching node ids, then returns `Node` objects.
- In memory mode, matched ids usually resolve from `TreeState`.
- In big-tree mode, matched ids are hydrated through the node cache first and then `NodeStore.getNode(id)` on cache miss.
- Index misses do not automatically scan disk. A miss means the local index has no match at its current fold watermark.
- Indexes are local and rebuildable. If backed by `IndexStore`, they may persist across cold starts, but the implementation must track a watermark so stale indexes can be resumed or rebuilt.

## Alignment with Big Trees

`big-trees.md` makes `TreeState` a cache over durable stores. Indexing should follow the same split:

| Concern | Small tree | Big tree |
| --- | --- | --- |
| Node source | `TreeState` map | `NodeStore` plus LRU cache |
| Index storage | JS `Map` | `IndexStore` backed by SQLite, IndexedDB, HTTP, etc. |
| Query result | `Node[]` from memory | ids from `IndexStore`, then hydrate missing nodes from `NodeStore` |
| Index miss | empty result | empty result; no implicit disk scan |
| Ad-hoc predicate query | full in-memory scan | explicit async scan over `NodeStore` |

The big-tree query path should look like:

```ts
async function queryIndex<K>(name: string, key: K): Promise<Node[]> {
  const ids = await indexStore.query(name, key)
  const nodes: Node[] = []

  for (const id of ids) {
    const encoded = nodeCache.get(id) ?? await nodeStore.getNode(id)
    if (encoded) {
      nodeCache.set(id, encoded)
      nodes.push(decodeNode(encoded))
    }
  }

  return nodes
}
```

This keeps `queryIndex` proportional to the number of matches. If a caller wants a fallback full-tree scan, they should call an explicit scan API:

```ts
for await (const node of tree.query(v =>
  v.props.size > 1000 && v.props.type === 'project'
)) {
  // ...
}
```

## More Examples

### Tag Inverted Index
```ts
// Index multi-valued "tags" property (arrays)
tree.createIndex<string>({
  name: 'byTag',
  type: 'custom',
  mapKey: v => (v.props.tags as string[] || [])
})
// Query items tagged "urgent"
const urgent = tree.queryIndex('byTag', 'urgent')
```

### Combining Index Queries
```ts
// e.g. items named "Docs" AND tagged "urgent"
const docs = new Set(tree.queryIndex('byName', 'Docs'))
const urgentDocs = tree.queryIndex('byTag', 'urgent')
  .filter(v => docs.has(v))
```

### Full-Tree Scan Fallback
```ts
// Ad-hoc predicate queries without an index in in-memory mode
const largeProjects = tree.query(v =>
  v.props.size > 1000 && v.props.type === 'project'
)
```

In big-tree mode this should be an explicit async scan over `NodeStore`, not
an implicit fallback inside `queryIndex`.
