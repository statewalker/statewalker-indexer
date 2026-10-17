# @statewalker/indexer-tests

Private workspace package; not published to npm.

## What it is

Vitest conformance suites for `@statewalker/indexer-*` backends. Each suite is a function that registers `describe`/`it` blocks; a backend calls the suites it needs from its own test file, passing factories and providers.

## Why it exists

All backends must behave the same through the `Indexer` / `Index` contract: registry, lifecycle, manifests and load actions, path prefixes, RRF fusion, several sub-indexes of one type, and the n-gram (grep) match semantics. Writing those tests once and running them against every backend is what keeps the backends interchangeable.

## How to use

Add as a dev dependency inside this workspace: `"@statewalker/indexer-tests": "workspace:^"`. It needs `vitest` (peer dependency). Its `exports` point at TypeScript sources, which Vitest loads directly.

| Export | Checks |
| --- | --- |
| `runKernelConformanceSuite(name, { factory, primaryConfig, secondaryConfig })` | Binding registry, create/get/delete, manifests, load actions, `onMissingProvider`, persistence round trip. |
| `runFullTextConformanceSuite(name, provider, { config })` | One full-text sub-index from a `FullTextProvider`. |
| `runFullTextMultiWordSuite(...)` | Multi-word full-text queries. |
| `runVectorConformanceSuite(name, provider, { config })` | One vector sub-index from a `VectorProvider`. |
| `runRrfBlendingSuite(name, { factory, config, populate, ... })` | Fusion order and sub-results. |
| `runMultiInstanceConformanceSuite(...)` | Several sub-indexes of the same type on one index. |
| `runNgramConformanceSuite(name, { factory, config })` | One n-gram sub-index (registered as `"g"`) through the `Indexer`: literal and regex matches with offsets and lines, default case sensitivity, score = match count, path scope, deletion and replacement, no match across blocks, patterns shorter than an n-gram, and `Index.search` fusion. `config` is the full sub-index config, e.g. `{ type: "ngram", store: "fts5" }`. |
| `MemoryPersistence`, `collect`, `defined` | Test helpers. |

`IndexerFactory` is `{ create(), createWithPersistence?(persistence), cleanup?() }`.

## Examples

Shortened from `packages/indexer-mem-minisearch/tests/suite.test.ts`:

```ts
import type { IndexerPersistence } from "@statewalker/indexer-api";
import { memVectorProvider } from "@statewalker/indexer-mem";
import {
  runFullTextConformanceSuite,
  runKernelConformanceSuite,
  runVectorConformanceSuite,
} from "@statewalker/indexer-tests";
import { createMiniSearchIndexer } from "../src/minisearch-indexer.js";
import { miniSearchFullTextProvider } from "../src/minisearch-provider.js";

const factory = {
  create: async () => createMiniSearchIndexer(),
  createWithPersistence: async (persistence: IndexerPersistence) => createMiniSearchIndexer({ persistence }),
};

runKernelConformanceSuite("MiniSearch + MemVector", {
  factory,
  primaryConfig: { type: "fulltext", language: "en" },
  secondaryConfig: { type: "vector", dimensionality: 3, model: "test" },
});
runFullTextConformanceSuite("MiniSearch FTS", miniSearchFullTextProvider, {
  config: { language: "en" },
});
runVectorConformanceSuite("MemVector", memVectorProvider, {
  config: { dimensionality: 3, model: "test" },
});
```

Run a backend's suites with `pnpm --filter @statewalker/indexer-mem-minisearch test` (after `pnpm build`).

## Internals

- The suites are self-contained: each creates its own small data set.
- `src/fixtures/` holds Markdown documents, queries and precomputed embeddings. They are not exported, because the loader uses Node file APIs.
- Dependencies: `@statewalker/indexer-api`, `@statewalker/indexer-fulltext`, `@statewalker/indexer-vector`, `@statewalker/indexer-ngram`, `@statewalker/indexer-search`; peer `vitest`.

## License

MIT
