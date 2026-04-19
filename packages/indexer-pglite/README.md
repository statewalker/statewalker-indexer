# @statewalker/indexer-pglite

PGlite-backed indexer implementation: full-text + vector search using in-browser Postgres.

## Installation

```sh
pnpm add @statewalker/indexer-pglite
```

## Usage

```ts
import { createPgliteIndexer } from "@statewalker/indexer-pglite";

const idx = await createPgliteIndexer({ dataDir: "idb://myapp" });
```

## API

- `createPgliteIndexer(options)` — returns an `@statewalker/indexer-api` compatible index backed by PGlite.

## Related

- `@statewalker/indexer-api`, `@electric-sql/pglite`.
