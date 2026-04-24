# @statewalker/indexer-mem-minisearch

In-memory implementation of `@statewalker/indexer-api` combining [MiniSearch](https://github.com/lucaong/minisearch) for full-text search with `@statewalker/indexer-mem`'s `MemVectorIndex` for embeddings. Optional streaming persistence via `IndexerPersistence`.

## Installation

```sh
pnpm add @statewalker/indexer-mem-minisearch
```

## Usage

```ts
import { createMiniSearchIndexer } from "@statewalker/indexer-mem-minisearch";

const indexer = createMiniSearchIndexer();
const index = await indexer.createIndex({
  name: "docs",
  fulltext: { language: "en" },
  vector: { dimensionality: 384, model: "all-MiniLM-L6-v2" },
});

await index.addDocument([
  { path: "/docs/a", blockId: "1", content: "hello world" },
]);

for await (const hit of index.search({ queries: ["hello"], topK: 10 })) {
  console.log(hit.path, hit.blockId, hit.score);
}
```

### With persistence

```ts
import { createMiniSearchIndexer } from "@statewalker/indexer-mem-minisearch";
import type { IndexerPersistence } from "@statewalker/indexer-api";

const persistence: IndexerPersistence = /* … your save/load adapter … */;
const indexer = createMiniSearchIndexer({ persistence });
```

Wire format (stable across releases): `__manifest__` (JSON array of index names), `${name}/__config__`, `${name}/fts` (MiniSearch `toJSON()`), `${name}/vec` (Arrow IPC from `MemVectorIndex`).

## API

- `createMiniSearchIndexer(options?)` — returns an `Indexer`. Options: `persistence?: IndexerPersistence`.
- `MiniSearchIndexerOptions` — option type.

## Related

- `@statewalker/indexer-api` — the pluggable contract.
- `@statewalker/indexer-mem-flexsearch` — drop-in alternative using FlexSearch.
- `@statewalker/indexer-mem` — provides the vector sub-index (`MemVectorIndex`).
