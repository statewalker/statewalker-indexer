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

## API

- `createDuckDbIndexer(options)` — returns a hybrid FTS + vector indexer.

## Related

- `@statewalker/indexer-api`, `@statewalker/db-api`, `@statewalker/db-duckdb-node`.
