# @statewalker/indexer-mem

In-memory base implementation of `@statewalker/indexer-api`. Scaffold reused by `indexer-mem-flexsearch` and `indexer-mem-minisearch`.

## Installation

```sh
pnpm add @statewalker/indexer-mem
```

## Usage

```ts
import { createMemIndex } from "@statewalker/indexer-mem";

const idx = createMemIndex();
await idx.add({ id: "1", text: "hello" });
```

## API

- `createMemIndex(options)` — lazy in-memory index.

## Related

- `@statewalker/indexer-mem-flexsearch` / `@statewalker/indexer-mem-minisearch` — drop-in FTS backends.
