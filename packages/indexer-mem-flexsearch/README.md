# @statewalker/indexer-mem-flexsearch

In-memory indexer implementation backed by FlexSearch for full-text search.

## Installation

```sh
pnpm add @statewalker/indexer-mem-flexsearch
```

## Usage

```ts
import { createFlexsearchIndex } from "@statewalker/indexer-mem-flexsearch";

const idx = createFlexsearchIndex();
await idx.add({ id: "1", text: "hello world" });
await idx.search("hello");
```

## API

- `createFlexsearchIndex(options)` — returns an `@statewalker/indexer-api`-compatible index.

## Related

- `@statewalker/indexer-api`, `@statewalker/indexer-mem`.
