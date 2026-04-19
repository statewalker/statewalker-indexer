# @statewalker/indexer-mem-minisearch

In-memory indexer implementation backed by MiniSearch for full-text search.

## Installation

```sh
pnpm add @statewalker/indexer-mem-minisearch
```

## Usage

```ts
import { createMinisearchIndex } from "@statewalker/indexer-mem-minisearch";

const idx = createMinisearchIndex();
await idx.add({ id: "1", text: "hello world" });
```

## API

- `createMinisearchIndex(options)` — returns an `@statewalker/indexer-api`-compatible index.

## Related

- `@statewalker/indexer-api`, `@statewalker/indexer-mem`.
