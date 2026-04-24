# @statewalker/indexer-pglite

PGlite-backed implementation of `@statewalker/indexer-api`: full-text search via PostgreSQL's native `tsvector` + GIN index, vector search via [pgvector](https://github.com/pgvector/pgvector) with an HNSW cosine index. Runs entirely in-process (in the browser, Node, or anywhere [PGlite](https://github.com/electric-sql/pglite) does).

## Installation

```sh
pnpm add @statewalker/indexer-pglite @electric-sql/pglite
```

## Usage

```ts
import { createPGLiteIndexer } from "@statewalker/indexer-pglite";

// Uses an in-memory PGlite instance by default.
const indexer = await createPGLiteIndexer();

// Or pass an existing PGlite (with the `vector` extension already loaded):
// import { PGlite } from "@electric-sql/pglite";
// import { vector } from "@electric-sql/pglite/vector";
// const db = await PGlite.create({ dataDir: "idb://myapp", extensions: { vector } });
// const indexer = await createPGLiteIndexer({ db });

const index = await indexer.createIndex({
  name: "docs",
  fulltext: { language: "en" },
  vector: { dimensionality: 384, model: "all-MiniLM-L6-v2" },
});
```

## Runtime extension

`createPGLiteIndexer` runs `CREATE EXTENSION IF NOT EXISTS vector` at init. When the factory creates its own PGlite (no `db` passed), it auto-loads the `vector` extension via PGlite's `extensions: { vector }` option; when a caller-supplied `db` is passed, the caller is responsible for having the extension available (pass `extensions: { vector }` to `PGlite.create`).

## SQL shape

Per named index:

- `idx_<prefix>_docs(doc_id SERIAL PRIMARY KEY, path TEXT UNIQUE)` — path ↔ doc_id mapping.
- `idx_<prefix>_fts(doc_id, block_id, content, content_tsv TSVECTOR GENERATED ..., metadata)` + `USING GIN (content_tsv)`.
- `idx_<prefix>_vec(doc_id, block_id, embedding vector(dim))` + `USING hnsw (embedding vector_cosine_ops)`.

Search uses `ts_rank_cd` + `to_tsquery(<lang>, ...)` for FTS, and the `<=>` cosine-distance operator for vector search.

## API

- `createPGLiteIndexer(options?)` — returns `Promise<Indexer>`. Options: `db?: PGlite` (bring your own; otherwise a fresh in-memory instance is created, and the returned indexer owns and will close it on `indexer.close()`).
- `PGLiteIndexerOptions` — option type.

## Related

- `@statewalker/indexer-api`, `@electric-sql/pglite`, `pgvector`.
