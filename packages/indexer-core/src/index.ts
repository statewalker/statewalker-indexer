// @statewalker/indexer-core — workspace-internal scaffolding shared by @statewalker/indexer-* backends.
// Not published to npm. Consumed via workspace:* by sibling backend packages only.

export { toAsyncIterable } from "./async.js";
export { compositeKey } from "./composite-key.js";
export { type CompositeIndexOptions, createCompositeIndex } from "./create-composite-index.js";
export {
  createPersistenceBackedIndexer,
  type PersistenceBackedIndexerOptions,
} from "./create-persistence-backed-indexer.js";
export {
  createSqlBackedIndexer,
  type SqlBackedDialect,
  type SqlBackedIndexerOptions,
} from "./create-sql-backed-indexer.js";
export {
  createSqlFtsRetriever,
  type SqlFtsDialect,
  type SqlFtsRetrieverOptions,
} from "./create-sql-fts-retriever.js";
export {
  createSqlVectorRetriever,
  type SqlVectorDialect,
  type SqlVectorRetrieverOptions,
} from "./create-sql-vector-retriever.js";
export { type FanOutSearchParams, fanOutSearch } from "./fan-out-search.js";
export { mergeByRRF, mergeByWeights, mergeHybrid } from "./merge.js";
export { matchesPrefix } from "./path-prefix.js";
export { readEntryBytes, singleChunk, toBytes } from "./persistence-bytes.js";
export {
  buildRrfTrace,
  type RankedList,
  type RRFContribution,
  type RRFTrace,
  reciprocalRankFusion,
} from "./rrf.js";
export { sanitizePrefix } from "./sanitize-prefix.js";
export type { SqlDb } from "./sql-db.js";
export { validateDimensionality } from "./validate-dimensionality.js";
