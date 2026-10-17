# @statewalker/indexer-fulltext

## What it is

The full-text modality for `@statewalker/indexer-api`: the sub-index types (`FullTextIndex`, `FullTextBlock`, `FulltextQuery`, `FulltextResult`), the `FullTextProvider` interface that backends implement, config helpers for `CreateIndexParams`, and `newFullTextAccess(name)`, a typed handle bound to one sub-index name. The modality type string is `"fulltext"` (`FULL_TEXT_TYPE`).

## Why it exists

The kernel addresses sub-indexes by name and stores queries and results as `unknown`. This package puts the full-text types back on top: an access handle reads and writes the sub-index, its config, its sub-query and its sub-result under one name, with the right types and without string-keyed map access in user code.

## How to use

```sh
pnpm add @statewalker/indexer-fulltext
```

One entry point, `@statewalker/indexer-fulltext`. Platform-neutral.

- `setFullTextConfig(params, name, { language, metadata? })` before `indexer.createIndex(params)`.
- `newFullTextAccess(name)` returns `{ name, get, tryGet, setConfig, getConfig, setQuery, getQuery, getResult }`.

## Examples

Two full-text sub-indexes on one index:

```ts
import { newFullTextAccess, setFullTextConfig } from "@statewalker/indexer-fulltext";

const params = { name: "docs" };
setFullTextConfig(params, "q", { language: "en" });
setFullTextConfig(params, "q_fr", { language: "fr" });
const index = await indexer.createIndex(params);

const en = newFullTextAccess("q");
await en.get(index).addDocument([{ path: "/docs/a", blockId: "1", content: "CAP theorem" }]);

const request = { topK: 10 };
en.setQuery(request, { queries: ["CAP theorem"], paths: ["/docs/"] });
for await (const r of index.search(request)) {
  const hit = en.getResult(r);
  console.log(r.path, r.blockId, "rrf:", r.score, "native:", hit?.score, hit?.snippet);
}
```

Implement a provider in a backend:

```ts
import { FULL_TEXT_TYPE, type FullTextProvider } from "@statewalker/indexer-fulltext";

export const myProvider: FullTextProvider = {
  type: FULL_TEXT_TYPE,
  create: (config) => new MyFullTextIndex(config), // must implement FullTextIndex
};
```

## Internals

- `setFullTextConfig` writes `params.subIndexes[name] = { type: "fulltext", ...config }`. The indexer finds the provider by that `type`. `getFullTextConfig` returns `undefined` when the entry is missing or has another type.
- `FulltextQuery` is `{ queries: string[], topK?, paths? }`. How several `queries` combine depends on the backend: the in-memory FlexSearch and MiniSearch indexes and SQLite add up per-query scores (blocks matching more queries rank higher); DuckDB and PGlite keep each block's best score. `topK` and `paths` here are what the sub-index uses; the top-level request values are not forwarded to it.
- `FulltextResult` is `{ path, blockId, score, snippet }`; `score` is the engine's native score (BM25 in DuckDB, `ts_rank_cd` in PGlite, `-bm25(...)` in SQLite FTS5).
- `language` handling is backend-specific: DuckDB and PGlite map ISO-639-1 codes (`"en"`, `"fr"`, ...) to stemmers / text-search configs; SQLite applies the Porter stemmer for exactly `"en"` and no stemming for any other value; the in-memory FlexSearch and MiniSearch indexes only store it.
- `get(index)` throws `No sub-index named "<name>" is registered on index "<index>"`. It does not check the binding's type.
- Dependencies: `@statewalker/indexer-api` only.

## License

MIT
