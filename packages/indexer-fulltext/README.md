# @statewalker/indexer-fulltext

Full-text modality contract for [`@statewalker/indexer-api`](../indexer-api/README.md).

Owns the **full-text** types — `FullTextIndex`, `FullTextBlock`, `FulltextQuery`, `FulltextResult`, `FullTextIndexInfo` — and the **adapter triple** registered at the stable key `"fulltext"`:

- `getFullTextIndex(index)` / `registerFullText(index, fts)` — read / register the full-text sub-index on a composite `Index`.
- `getFulltextQuery(request)` / `setFulltextQuery(request, q)` — attach the full-text sub-query to a `SearchRequest`.
- `getFulltextResult(result)` / `setFulltextResult(result, hit)` — attach the full-text sub-result to a `SearchResult`.
- `getFullTextConfig(params)` / `setFullTextConfig(params, cfg)` — write/read the FTS creation config in `CreateIndexParams.subIndexes`.

## Usage

```ts
import {
  registerFullText,
  setFulltextQuery,
  getFulltextResult,
  setFullTextConfig,
} from "@statewalker/indexer-fulltext";

// 1. Tell the indexer to provision a full-text sub-index when creating.
const params = { name: "docs" };
setFullTextConfig(params, { language: "english" });
const index = await indexer.createIndex(params);

// 2. Build a search request with a full-text sub-query.
const request = { topK: 10 };
setFulltextQuery(request, { queries: ["CAP theorem"] });

// 3. Read native scores + snippets off the sub-result.
for await (const r of index.search(request)) {
  const fts = getFulltextResult(r);
  console.log(r.path, r.blockId, "rrf:", r.score, "bm25:", fts?.score, fts?.snippet);
}
```

## Related

- [`@statewalker/indexer-api`](../indexer-api/README.md) — kernel contract
- [`@statewalker/indexer-vector`](../indexer-vector/README.md) — vector modality
- `@statewalker/indexer-mem-flexsearch`, `@statewalker/indexer-mem-minisearch` — backend implementations
