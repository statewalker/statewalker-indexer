export {
  buildCollectionClause,
  isCollectionPrefix,
  matchesCollection,
  resolveCollections,
} from "./collection-filter.js";
export type {
  FullTextIndex,
  FullTextIndexInfo,
} from "./full-text-index.js";
export type {
  CreateIndexParams,
  Indexer,
  IndexInfo,
} from "./indexer.js";
export type { Index } from "./indexer-index.js";
export type { ChunkSelection } from "./intent.js";
export { extractIntentTerms, selectBestChunk } from "./intent.js";
export { defaultMultiSearch } from "./multi-search.js";
export type {
  IndexerPersistence,
  PersistenceEntry,
} from "./persistence.js";
export type { ParsedQuery, QueryType } from "./query-parser.js";
export {
  parseStructuredQuery,
  validateLexQuery,
  validateSemanticQuery,
} from "./query-parser.js";
export type { BlendTier } from "./reranker-blend.js";
export { blendWithReranker, DEFAULT_BLEND_TIERS } from "./reranker-blend.js";
export type { RankedList, RRFContribution, RRFTrace } from "./rrf.js";
export { buildRrfTrace, reciprocalRankFusion } from "./rrf.js";
export type { EmbedFn } from "./semantic-index.js";
export { SemanticIndex } from "./semantic-index.js";
export type {
  BlockId,
  CollectionFilter,
  CollectionId,
  GroupedSearchResult,
  HybridWeights,
  Metadata,
  MultiSearchParams,
  MultiSearchResult,
  ScoredResult,
  SearchResult,
} from "./types.js";
export { DEFAULT_COLLECTION } from "./types.js";
export type {
  VectorIndex,
  VectorIndexInfo,
} from "./vector-index.js";
