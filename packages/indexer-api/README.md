# @statewalker/indexer-api

## What it is

The backend-agnostic contract for search indexes. An `Indexer` creates and opens named `Index` objects. Each `Index` is an open registry of named sub-indexes; every sub-index has a modality type (for example `"fulltext"` or `"vector"`) and its own config, and several sub-indexes of the same type can live on one index. `Index.search` runs the sub-indexes named in the request and fuses their hits with reciprocal rank fusion (RRF). The package holds the kernel types plus five small runtime helpers.

## Why it exists

Application code should not depend on a storage engine. With this contract the same code runs against in-memory FlexSearch/MiniSearch indexes, DuckDB, PGlite or SQLite, and tests can swap backends freely. The kernel knows nothing about modalities: full-text, vector and n-gram types live in `@statewalker/indexer-fulltext`, `@statewalker/indexer-vector` and `@statewalker/indexer-ngram`, so adding a modality (for example a graph index) is a new package and no change here.

## How to use

```sh
pnpm add @statewalker/indexer-api
```

One entry point, `@statewalker/indexer-api`: types and the helpers `getSubQuery`, `setSubQuery`, `getSubResult`, `setSubResult`, `isPersistable`. Platform-neutral.

The model:

```
Indexer                 getIndexNames / createIndex / getIndex / hasIndex / deleteIndex / flush / close
  Index                 registry of SubIndexBindings + search (RRF) + lifecycle fan-out
    SubIndexBinding     { name, type, config, index }
      SearchIndex       one sub-index: addDocument(s), search, enumeration, lifecycle

SearchRequest  { topK, paths?, subQueries: { [subIndexName]: subQuery } }
SearchResult   { path, blockId, score /* RRF */, subResults: { [subIndexName]: nativeHit } }
```

- Documents are identified by a `DocumentPath` (`` `/${string}` ``) and split into blocks (`BlockId`). `path` + `blockId` is unique in an index.
- Path prefixes match on path components in every backend: `/docs` matches `/docs` and `/docs/a`, not `/docs2`. A prefix ending in `/` matches anything starting with it.
- Ingestion and enumeration happen on each sub-index. `Index` has no `addDocument`.
- A sub-index runs only if its name is a key of `request.subQueries`.

## Examples

Create an index with two sub-indexes, write, and search. The access handles come from the modality packages:

```ts
import type { Indexer } from "@statewalker/indexer-api";
import { newFullTextAccess, setFullTextConfig } from "@statewalker/indexer-fulltext";
import { newVectorAccess, setVectorConfig } from "@statewalker/indexer-vector";

declare const indexer: Indexer; // e.g. createMiniSearchIndexer() from @statewalker/indexer-mem-minisearch
declare const embed: (text: string) => Promise<Float32Array>;

const params = { name: "docs" };
setFullTextConfig(params, "q", { language: "en" });
setVectorConfig(params, "semantic", { dimensionality: 384, model: "all-MiniLM-L6-v2" });
const index = await indexer.createIndex(params);

const fts = newFullTextAccess("q");
const vec = newVectorAccess("semantic");
await fts.get(index).addDocument([{ path: "/docs/a", blockId: "1", content: "hello world" }]);
await vec.get(index).addDocument([
  { path: "/docs/a", blockId: "1", embedding: await embed("hello world") },
]);

const request = { topK: 10 };
fts.setQuery(request, { queries: ["hello"], paths: ["/docs/"] });
vec.setQuery(request, { embeddings: [await embed("greeting")], paths: ["/docs/"] });

for await (const r of index.search(request)) {
  console.log(r.path, r.blockId, r.score, fts.getResult(r)?.snippet, vec.getResult(r)?.score);
}
```

The same query with the kernel helpers, when the sub-index type is only known at runtime:

```ts
import { getSubResult, setSubQuery, type SearchRequest } from "@statewalker/indexer-api";

const request: SearchRequest = { topK: 10 };
setSubQuery(request, "q", { queries: ["hello"] });
for await (const r of index.search(request)) {
  const hit = getSubResult<{ score: number; snippet: string }>(r, "q");
}
```

Open a saved index. Per sub-index name you adopt the saved state (default: no entry), reinitialise with a new config, or skip it:

```ts
const index = await indexer.getIndex("docs", {
  subIndexes: {
    semantic: { type: "vector", dimensionality: 768, model: "other-model" }, // reinit, saved vectors dropped
    q_fr: { skip: true }, // not registered; its saved data is kept
  },
  onMissingProvider: "warn", // default "throw"
});
// null if no index named "docs" exists
```

`isPersistable(subIndex)` tells whether a sub-index implements `serialise()` / `loadFrom()`.

## Internals

### Why the top-level score is a rank, not a relevance

BM25 and cosine similarity live on different scales, so `Index.search` fuses ranked lists with RRF and sets `SearchResult.score` to the fusion score. It is comparable only within one search. The native score of each sub-index stays on `result.subResults[name]`; read it with `getSubResult` or an access handle.

### What breaks

- **Top-level `paths` is not a filter.** The composite in `@statewalker/indexer-core` hands each sub-index only its own sub-query. Put `paths` on each sub-query (as in the example above) or the search covers the whole index.
- **Top-level `topK` truncates only the fused list.** Retrieval depth per sub-index is the sub-query's `topK`.
- `createIndex` throws `Index "<name>" already exists` unless `overwrite: true`. The in-memory backends throw `Cannot create index "<name>": sub-index "<sub>" requires a provider of type "<type>" ...` for an unknown type, and the SQLite backend throws `Cannot load index: sub-index "<sub>" requires modality "<type>" but only [...] are registered.`; the SQL backends (DuckDB, PGlite, SQLite) throw `Cannot create index without any subIndexes` when `subIndexes` is empty.
- `getIndex` throws `Cannot load index ...: sub-index "<sub>" requires ...` under the default `onMissingProvider: "throw"` when a saved sub-index type has no provider; with `"warn"` it logs and skips that sub-index.
- Access handle `get(index)` throws `No sub-index named "<name>" is registered on index "<index>"`; use `tryGet` to probe.

### Persistence port

`IndexerPersistence` is `{ save(entries), load() }` over `PersistenceEntry { name, content: AsyncIterable<Uint8Array> }`. Entries stream so large indexes are not held in one buffer.

### Exported types

`Indexer`, `CreateIndexParams`, `GetIndexOptions`, `LoadAction`, `IndexInfo`, `Index`, `SearchIndex`, `PersistableSearchIndex`, `ModalityProvider`, `SubIndexBinding`, `AnySubIndexBinding`, `SearchRequest`, `SearchResult`, `ScoredHit`, `ScoredItem`, `DocumentPath`, `BlockId`, `BlockReference`, `PathSelector`, `Metadata`, `EmbedFn`, `IndexerPersistence`, `PersistenceEntry`.

### Dependencies

None.

## License

MIT
