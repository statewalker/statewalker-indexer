# @statewalker/indexer-pglite

## What it is

An `Indexer` stored in [PGlite](https://github.com/electric-sql/pglite) (PostgreSQL compiled to WASM). Full-text sub-indexes use PostgreSQL `tsvector` columns with a GIN index and `ts_rank_cd` scoring; vector sub-indexes use pgvector with an HNSW cosine index. It runs in the browser, in Node and in workers.

## Why it exists

It gives real PostgreSQL text search (stemming per language) and an approximate nearest-neighbour vector index without a server. With an IndexedDB or file `path`, data persists without a separate save step.

## How to use

```sh
pnpm add @statewalker/indexer-pglite
```

The indexer runs over a `Db` from `@statewalker/db-pglite`. Open it with the pgvector extension — the indexer issues `CREATE EXTENSION IF NOT EXISTS vector` and fails with `extension "vector" is not available` otherwise. The indexer never closes the `Db`; close it yourself.

- `createPGLiteIndexer({ db }): Promise<Indexer>` — `db: Db`.
- `PGLiteIndexerOptions` — the options type.

## Examples

In-memory database:

```ts
import { vector } from "@electric-sql/pglite-pgvector";
import { newPgliteDb } from "@statewalker/db-pglite";
import { createPGLiteIndexer } from "@statewalker/indexer-pglite";
import { newFullTextAccess, setFullTextConfig } from "@statewalker/indexer-fulltext";

const db = await newPgliteDb({ extensions: { vector } });
const indexer = await createPGLiteIndexer({ db });

const params = { name: "docs" };
setFullTextConfig(params, "q", { language: "en" });
const index = await indexer.createIndex(params);

const fts = newFullTextAccess("q");
await fts.get(index).addDocument([{ path: "/docs/a", blockId: "1", content: "running dogs" }]);

const request = { topK: 10 };
fts.setQuery(request, { queries: ["run"] }); // stemmed: matches "running"
for await (const r of index.search(request)) {
  console.log(r.path, r.blockId, fts.getResult(r)?.score); // ts_rank_cd
}

await indexer.close();
await db.close();
```

Persistent database:

```ts
import { vector } from "@electric-sql/pglite-pgvector";
import { newPgliteDb } from "@statewalker/db-pglite";
import { createPGLiteIndexer } from "@statewalker/indexer-pglite";

const db = await newPgliteDb({ path: "idb://my-app", extensions: { vector } });
const indexer = await createPGLiteIndexer({ db });
// indexer.close() does not close db; call db.close() yourself
```

## Internals

### The vector extension must be loaded

At startup the indexer runs `CREATE EXTENSION IF NOT EXISTS vector`. The `Db` you pass in must be opened with `extensions: { vector }`, otherwise this statement fails with `extension "vector" is not available` and the indexer is not created.

### Tables

```
__indexer_manifest(name, config)
idx_<index>_docs(doc_id SERIAL, path UNIQUE)               path -> doc_id
idx_<index>_<sub>_fts(doc_id, block_id, content, content_tsv TSVECTOR GENERATED, metadata)  + GIN
idx_<index>_<sub>_vec(doc_id, block_id, embedding vector(dim))                              + HNSW vector_cosine_ops
```

`content_tsv` is a generated column, so the full-text index is always current; there is no rebuild step.

### Queries, scores and languages

- A full-text query is lowercased, split on whitespace, stripped of tsquery operators (`& | ! ( ) : ' " \`) and joined with `|` (OR). Score is `ts_rank_cd`. With several `queries` in one sub-query, each block keeps its best score across them (scores are not summed).
- Vector `score` is `1 - (embedding <=> query)` (cosine). Embeddings are sent as text literals cast to `vector(dim)`.
- `language` accepts ISO-639-1 codes (`en`, `fr`, `de`, `es`, `it`, `pt`, `nl`, `ru`, `sv`, `no`, `da`, `fi`, `hu`, `ro`, `tr`), `simple`, or the matching Postgres config names (`english`, ...). Anything else throws `pglite FTS: unsupported language "<x>" (must be an ISO-639-1 code or a Postgres text-search config name)`. The value is put into SQL, which is why it is checked against this list.
- Default retrieval depth is `topK = 100` per sub-query.

### Dependencies

`@statewalker/db-api` (the `Db` it runs on), `@statewalker/indexer-core` (`createSqlIndexer` and the SQL retrievers), `@statewalker/indexer-api`, `@statewalker/indexer-fulltext`, `@statewalker/indexer-vector`.

## License

MIT
