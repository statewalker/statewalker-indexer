# @statewalker/indexer-duckdb

DuckDB-backed indexer implementation: full-text search + vector similarity on top of `@statewalker/db-api`.

## Installation

```sh
pnpm add @statewalker/indexer-duckdb @statewalker/db-duckdb-node
```

## Usage

```ts
import { createDuckDbIndexer } from "@statewalker/indexer-duckdb";
import { createDuckDbNodeClient } from "@statewalker/db-duckdb-node";

const db = await createDuckDbNodeClient({ path: "./index.duckdb" });
const idx = await createDuckDbIndexer({ db });
```

## Runtime DuckDB extensions

`createDuckDbIndexer` installs and loads two DuckDB extensions on startup:

- **`fts`** — BM25 full-text search. The indexer calls `PRAGMA create_fts_index(...)` and queries via `fts_main_<table>.match_bm25(id, query)`. The FTS index is rebuilt lazily: the retriever tracks a dirty flag set on every `addDocument` / `deleteDocuments` call and rebuilds on the first `search` thereafter (or sooner via explicit `flush()`).
- **`vss`** — HNSW vector similarity index. `SET hnsw_enable_experimental_persistence = true;` is also set so HNSW indexes survive database close/reopen.

Both extensions ship with DuckDB and are fetched from the DuckDB extension repository on first `INSTALL`. Running `createDuckDbIndexer` in an environment that blocks extension downloads will fail at init time with the missing-extension error surfaced by DuckDB.

## API

- `createDuckDbIndexer(options)` — returns a hybrid FTS + vector indexer.

## Related

- `@statewalker/indexer-api`, `@statewalker/db-api`, `@statewalker/db-duckdb-node`.
