# @statewalker/indexer-core

Workspace-internal scaffolding shared by the `@statewalker/indexer-*` backends.

**Not published to npm.** This package is `"private": true` and consumed via `workspace:*` by sibling backends only (`indexer-mem`, `indexer-mem-flexsearch`, `indexer-mem-minisearch`, `indexer-duckdb`, `indexer-pglite`).

## What it holds

All the engine-agnostic code that would otherwise be forked across every backend.

### Composite index
- `createCompositeIndex({ name, fts, vec, metadata?, getSize?, onDeleteIndex? })` — returns a value satisfying the public `Index` contract. Fans FTS and vector sub-indexes out on `search`/`addDocument`/`deleteDocuments`; unions sub-index references for `getDocumentPaths`, `getDocumentBlocksRefs`, `getDocumentsBlocks` (de-duped by composite key — O(N), no separate tracking map). Backends inject their engine-specific `getSize` closure (SQL UNION for DuckDB/PGlite, sub-index enumeration for mem) and an optional `onDeleteIndex` hook (SQL backends `DROP TABLE` the shared docs table).

### Merge / rank fusion
- `mergeByRRF(fts, vec, topK)` and `mergeByWeights(fts, vec, weights, topK)` — single source of truth. Both key results by `compositeKey(path, blockId)`; this is deliberately different from `@statewalker/indexer-api`'s `reciprocalRankFusion`, which keys by `blockId` alone and applies a top-rank bonus.
- `mergeHybrid(fts, vec, topK, weights?)` — convenience dispatcher.

### Generic `Indexer` factory builders
- `createPersistenceBackedIndexer<F, V>({ createFts, serializeFts, deserializeFts, createVec, serializeVec, deserializeVec, persistence? })` — used by both mem backends. Preserves the save/load wire format byte-for-byte: `__manifest__`, `${name}/__config__`, `${name}/fts`, `${name}/vec`.
- `createSqlBackedIndexer({ db, dialect, onClose? })` — used by DuckDB and PGlite. Manages the shared `__indexer_manifest` table, extension init, per-index DDL/drop, and composite assembly.

### SQL retrievers (shared CRUD)
- `createSqlFtsRetriever({ db, prefix, docsTable, info, dialect: SqlFtsDialect })` — shared FTS sub-index: `resolveDocId`, path-filter SQL, ingest/delete, enumeration. Dialect supplies `createTableDdl`, optional `rebuild` (triggered lazily on first search after writes; used by DuckDB's `fts` extension), and `search`.
- `createSqlVectorRetriever({ db, prefix, docsTable, info, dialect: SqlVectorDialect })` — shared vector sub-index with the same shape. Dialect supplies `createTableDdl` (incl. HNSW index), `bindEmbedding`, `embeddingCastSuffix`, `search`, `decodeEmbedding`.
- `SqlDb` — minimal normalised async SQL client the retrievers consume. Each backend wraps its native driver (DuckDB's `Db` from `@statewalker/db-api`; PGlite's `PGlite`) to satisfy it.
- `SqlBackedDialect` — per-backend bundle: `extensionInit`, `docsTableDdl`, `extraCleanup?`, `unionAliasSuffix` (PGlite requires `AS combined`), `fts`, `vec`.

### Pure helpers
`compositeKey`, `matchesPrefix`, `sanitizePrefix`, `validateDimensionality`, `toAsyncIterable`, and persistence byte helpers (`toBytes`, `singleChunk`, `readEntryBytes`).

## Design

See [openspec change `indexer-core-consolidation`](../../../../openspec/changes/indexer-core-consolidation/) (archived) for the full design document, specs, and per-phase implementation plan.
