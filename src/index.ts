export type {
  Citation,
  CitationBuilderFn,
  EntryExplain,
  ExpandedQuery,
  PipelineConfig,
  PipelineEntry,
  QueryExpanderFn,
  RerankerFn,
  RerankResult,
} from "./helpers/index.js";
export {
  createMockCitationBuilder,
  createMockExpander,
  createMockReranker,
  indexDocuments,
  SearchPipeline,
} from "./helpers/index.js";
export type {
  CreateIndexParams,
  Indexer,
  IndexInfo,
} from "./indexer.js";
export type {
  BlockId,
  BlockReference,
  DocumentPath,
  EmbeddingBlock,
  EmbeddingIndex,
  EmbeddingIndexInfo,
  EmbeddingSearchParams,
  EmbeddingSearchResult,
  FullTextBlock,
  FullTextIndex,
  FullTextIndexInfo,
  FullTextSearchParams,
  FullTextSearchResult,
  HybridSearchParams,
  HybridSearchResult,
  HybridWeights,
  Index,
  IndexedBlock,
  Metadata,
  PathSelector,
} from "./indexer-index.js";
export type { ChunkSelection } from "./intent.js";
export { extractIntentTerms, selectBestChunk } from "./intent.js";
export type {
  MultiSearchParams,
  MultiSearchResult,
} from "./multi-search.js";
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
export type {
  RankedList,
  RRFContribution,
  RRFTrace,
  ScoredItem,
} from "./rrf.js";
export { buildRrfTrace, reciprocalRankFusion } from "./rrf.js";
export type { EmbedFn } from "./semantic-index.js";
export { SemanticIndex } from "./semantic-index.js";
