# @statewalker/indexer-mem-flexsearch

In-memory implementation of `@statewalker/indexer-api` combining [FlexSearch](https://github.com/nextapps-de/flexsearch) for full-text search with `@statewalker/indexer-mem`'s `MemVectorIndex` for embeddings. Optional streaming persistence via `IndexerPersistence`.

## Installation

```sh
pnpm add @statewalker/indexer-mem-flexsearch
```

## Usage

```ts
import { createFlexSearchIndexer } from "@statewalker/indexer-mem-flexsearch";

const indexer = createFlexSearchIndexer();
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
import { createFlexSearchIndexer } from "@statewalker/indexer-mem-flexsearch";
import type { IndexerPersistence } from "@statewalker/indexer-api";

const persistence: IndexerPersistence = /* … your save/load adapter … */;
const indexer = createFlexSearchIndexer({ persistence });

// First use loads existing state; `indexer.flush()` writes current state back.
```

Wire format (stable, byte-compatible across releases): `__manifest__` (JSON array of index names), `${name}/__config__`, `${name}/fts` (FlexSearch serialized state), `${name}/vec` (Arrow IPC from `MemVectorIndex`).

## API

- `createFlexSearchIndexer(options?)` — returns an `Indexer`. Options: `persistence?: IndexerPersistence`.
- `FlexSearchIndexerOptions` — option type.

## Related

- `@statewalker/indexer-api` — the pluggable contract.
- `@statewalker/indexer-mem-minisearch` — drop-in alternative using MiniSearch.
- `@statewalker/indexer-mem` — provides the vector sub-index (`MemVectorIndex`).
