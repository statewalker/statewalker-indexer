# @statewalker/indexer-core

Workspace-internal scaffolding shared by the `@statewalker/indexer-*` backends.

**Not published to npm.** This package is consumed via `workspace:*` by sibling backend packages only (`indexer-mem`, `indexer-mem-flexsearch`, `indexer-mem-minisearch`, `indexer-duckdb`, `indexer-pglite`).

## Purpose

Holds engine-agnostic code that would otherwise be forked across every backend:

- Shared pure helpers (`compositeKey`, `matchesPrefix`, `sanitizePrefix`, `validateDimensionality`, `toAsyncIterable`, persistence byte helpers).
- Unified hybrid merge (`mergeHybrid`) delegating RRF to `@statewalker/indexer-api`'s `reciprocalRankFusion`.
- One composite-index factory (`createCompositeIndex`) replacing `MemIndex` / `DuckDbIndex` / `PGLiteIndex`.
- Two generic `Indexer` factory builders: `createPersistenceBackedIndexer` (mem) and `createSqlBackedIndexer` (SQL).
- A `SqlRetrieverBase` + `SqlDialect` pair holding shared SQL CRUD; dialects override only search SQL + DDL + embedding binding.

See [openspec change `indexer-core-consolidation`](../../../../openspec/changes/indexer-core-consolidation/) for the design and migration plan.
