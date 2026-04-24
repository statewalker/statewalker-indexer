// @statewalker/indexer-core — workspace-internal scaffolding shared by @statewalker/indexer-* backends.
// Not published to npm. Consumed via workspace:* by sibling backend packages only.

export { toAsyncIterable } from "./async.js";
export { compositeKey } from "./composite-key.js";
export { type CompositeIndexOptions, createCompositeIndex } from "./create-composite-index.js";
export {
  createPersistenceBackedIndexer,
  type PersistenceBackedIndexerOptions,
} from "./create-persistence-backed-indexer.js";
export { mergeByRRF, mergeByWeights, mergeHybrid } from "./merge.js";
export { matchesPrefix } from "./path-prefix.js";
export { readEntryBytes, singleChunk, toBytes } from "./persistence-bytes.js";
export { sanitizePrefix } from "./sanitize-prefix.js";
export { validateDimensionality } from "./validate-dimensionality.js";
