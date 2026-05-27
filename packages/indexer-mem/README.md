# @statewalker/indexer-mem

In-memory vector sub-index (`MemVectorIndex`) implementing the `EmbeddingIndex` contract from `@statewalker/indexer-api`. Consumed by the FTS-backed mem indexers (`indexer-mem-flexsearch`, `indexer-mem-minisearch`), which combine it with a full-text sub-index via `@statewalker/indexer-core`'s composite-index factory.

## Usage

This package is a piece of scaffolding — consumers should reach for the concrete indexer packages:

```ts
import { createFlexSearchIndexer } from "@statewalker/indexer-mem-flexsearch";
// or
import { createMiniSearchIndexer } from "@statewalker/indexer-mem-minisearch";

const indexer = createFlexSearchIndexer();
const index = await indexer.createIndex({
  name: "docs",
  fulltext: { language: "en" },
  vector: { dimensionality: 384, model: "all-MiniLM-L6-v2" },
});

await index.addDocument([
  { path: "/docs/a", blockId: "1", content: "hello world", embedding: queryEmbedding },
]);

for await (const hit of index.search({ queries: ["hello"], embeddings: [queryEmbedding], topK: 10 })) {
  console.log(hit);
}
```

## Exports

- `MemVectorIndex` — in-memory vector sub-index with brute-force cosine search and Arrow IPC serialization (used as the vector side of both mem-flexsearch and mem-minisearch).

## Related

- `@statewalker/indexer-api` — public types and contract
- `@statewalker/indexer-mem-flexsearch` / `@statewalker/indexer-mem-minisearch` — end-user factories combining `MemVectorIndex` with a full-text backend
