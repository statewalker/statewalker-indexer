# @statewalker/indexer-tests

> Internal, workspace-only dev dependency. **Not published**.

Shared Vitest suite that every `@statewalker/indexer-*` backend runs against. Covers the full [`Indexer`/`Index`/`FullTextIndex`/`EmbeddingIndex`](../indexer-api/src/) contract: lifecycle, CRUD, path-prefix filtering, hybrid search, persistence round-trip, multi-indexer isolation, and search-quality fixtures.

## Usage

In a backend package's `tests/suite.test.ts`:

```ts
import { runIndexerTestSuite } from "@statewalker/indexer-tests";
import { createFlexSearchIndexer } from "@statewalker/indexer-mem-flexsearch";

runIndexerTestSuite("FlexSearch Indexer", async () => createFlexSearchIndexer());
```

The factory callback is invoked per-test to produce a fresh `Indexer` (in-memory for mem backends, a fresh DuckDB/PGlite instance for SQL backends).

## Exports

- `runIndexerTestSuite(name, factory)` — main cross-backend suite entry point.
- `IndexerFactory` — type alias for the factory callback.
- Fixture loaders: `loadBlocksFixture`, `loadQueriesFixture`, `loadQueriesEmbeddingsFixture`, `listFixtureDocs`, `readFixtureDoc`.
- `createFixtureEmbedFn`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_MODEL` — deterministic embedding helpers for test inputs.

## Related

- `@statewalker/indexer-api` — contract these tests enforce.
