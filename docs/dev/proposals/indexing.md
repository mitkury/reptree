# Indexing in RepTree

RepTree can support local secondary indexes to enable fast queries over vertices and properties. Indexes are maintained by subscribing to CRDT events and stored in memory. Below is a proposed API and usage example.

## API
```ts
import { RepTree, Vertex } from 'reptree'

type IndexType = 'property' | 'fulltext' | 'custom'

interface IndexOptions<K> {
  name: string
  type: IndexType
  // property index: key in vertex properties
  property?: string
  // full-text index: tokenizer for property values
  tokenizer?: (s: string) => string[]
  // custom index: map a vertex to one or more keys
  mapKey?: (v: Vertex) => K | K[]
  // treat returned array or property values as multi-valued
  multiValued?: boolean
}

declare module 'reptree' {
  interface RepTree {
    createIndex<K>(opts: IndexOptions<K>): void
    dropIndex(name: string): void
    hasIndex(name: string): boolean
    listIndices(): string[]
    queryIndex<K>(name: string, key: K): Vertex[]
    /** Subscribe to index update events */
    observeIndex<K>(
      name: string,
      listener: (v: Vertex, action: 'add' | 'remove', key: K) => void
    ): () => void
    query(fn: (v: Vertex) => boolean): Vertex[]
  }
}
```

### Full-text Index

To create a full-text index, set `type: 'fulltext'`, specify the `property` to index, and provide a `tokenizer` function that splits text into tokens. Tokens are indexed as keys; use `multiValued: true` to index all tokens per vertex.

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

A custom index maps each vertex to one or more keys via `mapKey`. It can return a single key or an array of keys. Set `multiValued: true` when mapping to multiple keys.

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
- `createIndex` seeds a map from existing vertices
- Subscribes to CRDT events (`op`, `propSet`) to keep indexes up-to-date
- `queryIndex` performs O(1) map lookups
- Indexes are local and rebuilt on cold start

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
// Ad-hoc predicate queries without an index
const largeProjects = tree.query(v =>
  v.props.size > 1000 && v.props.type === 'project'
)
