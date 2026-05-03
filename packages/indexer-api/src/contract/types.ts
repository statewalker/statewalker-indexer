// =============================================================================
// Indexer Contract — Data Types
//
// Pure data shapes used by every backend implementation and the application-
// side strategy stack (`@statewalker/indexer-search`). Zero runtime.
//
// Logical layout:
//   1. Primitives        (DocumentPath, BlockId, Metadata)
//   2. References        (BlockReference, PathSelector)
//   3. Block types       (IndexedBlock, FullTextBlock, EmbeddingBlock)
//   4. Search params     (FullTextSearchParams, EmbeddingSearchParams, HybridSearchParams)
//   5. Search results    (FullTextSearchResult, EmbeddingSearchResult, HybridSearchResult)
//   6. Hybrid weights    (HybridWeights)
//   7. Ranking primitive (ScoredItem)
//   8. Embed function    (EmbedFn)
// =============================================================================

// =============================================================================
// 1. Primitive types
// =============================================================================

/**
 * Hierarchical path identifying a document within the index.
 *
 * Must start with `"/"`. Paths act as grouping keys — all blocks sharing
 * the same path belong to the same logical document. Path prefixes are used
 * throughout the API for filtering (e.g. `"/docs/"` matches `"/docs/a"`,
 * `"/docs/b"`, etc.).
 *
 * @example "/documents/readme/"
 * @example "/projects/alpha/specs/"
 */
export type DocumentPath = `/${string}`;

/**
 * Opaque identifier for a content block within a document.
 *
 * The combination of {@link DocumentPath} and `BlockId` must be unique
 * across the entire index.
 */
export type BlockId = string;

/**
 * Arbitrary key-value metadata that can be attached to indexes, documents,
 * or individual blocks.
 */
export type Metadata = Record<string, unknown>;

// =============================================================================
// 2. References
// =============================================================================

/**
 * Uniquely identifies a single block in the index by its document path
 * and block id. Used in search results and for point lookups / selections.
 */
export type BlockReference = {
  /** Document this block belongs to. */
  path: DocumentPath;
  /** Block identifier, unique within its document path. */
  blockId: BlockId;
};

/**
 * Selector for bulk selection. Identifies documents by a path prefix and,
 * optionally, a specific block within those documents.
 *
 * - If only `path` is provided, all blocks under that path prefix are selected.
 * - If `blockId` is also provided, only the matching block is selected.
 */
export type PathSelector = {
  /** Path prefix selecting the target documents. */
  path: DocumentPath;
  /** Optional specific block to select; when omitted all blocks under `path` are selected. */
  blockId?: BlockId;
};

// =============================================================================
// 3. Block types
// =============================================================================

/**
 * A block of content to be added to the hybrid index.
 *
 * At least one of `content` or `embedding` must be provided — a block with
 * neither has nothing to index. When both are present the block is indexed
 * in both the FTS and vector sub-indexes.
 */
export interface IndexedBlock extends BlockReference {
  /** Text content for full-text indexing. Required if the index has an FTS sub-index. */
  content?: string;
  /** Embedding vector for similarity search. Required if the index has a vector sub-index. */
  embedding?: Float32Array;
  /** Optional metadata stored alongside the block. */
  metadata?: Metadata;
}

/**
 * A block of text content for the full-text sub-index.
 *
 * Unlike {@link IndexedBlock}, `content` is required here since the FTS
 * index cannot operate without text.
 */
export interface FullTextBlock extends BlockReference {
  /** The text content to be indexed for full-text search. */
  content: string;
  /** Optional metadata stored alongside the block. */
  metadata?: Metadata;
}

/**
 * A block carrying an embedding vector for the vector sub-index.
 *
 * Unlike {@link IndexedBlock}, `embedding` is required here since the
 * vector index cannot operate without a vector.
 */
export interface EmbeddingBlock extends BlockReference {
  /** The embedding vector (dense float array) representing this block's content. */
  embedding: Float32Array;
  /** Optional metadata stored alongside the block. */
  metadata?: Metadata;
}

// =============================================================================
// 4. Search parameters
// =============================================================================

/**
 * Weights controlling how FTS and embedding scores are blended in hybrid
 * search. Both values are relative — only their ratio matters.
 *
 * @example { fts: 0.7, embedding: 0.3 }
 */
export interface HybridWeights {
  /** Weight assigned to full-text search scores. */
  fts: number;
  /** Weight assigned to embedding similarity scores. */
  embedding: number;
}

/**
 * Parameters for a full-text search query against the FTS sub-index.
 */
export interface FullTextSearchParams {
  /** Path prefixes to restrict the search scope. When empty, searches all documents. */
  paths?: DocumentPath[];
  /** One or more FTS queries. Blocks matching more queries rank higher. */
  queries: string[];
  /** Maximum number of results to return. */
  topK: number;
}

/**
 * Parameters for a vector similarity search against the embedding sub-index.
 */
export interface EmbeddingSearchParams {
  /** Path prefixes to restrict the search scope. When empty, searches all documents. */
  paths?: DocumentPath[];
  /** One or more embedding vectors to search for. Blocks matching more vectors rank higher. */
  embeddings: Float32Array[];
  /** Maximum number of results to return. */
  topK: number;
}

/**
 * Parameters for a hybrid search combining FTS and vector queries.
 *
 * Both `queries` and `embeddings` are optional — providing only one of them
 * degrades the search to a single-modality search. At least one must be
 * provided for the search to produce results.
 */
export interface HybridSearchParams {
  /** Path prefixes to restrict the search scope. Defaults to `["/"]` (entire index). */
  paths?: DocumentPath[];
  /** FTS queries — blocks matching more queries rank higher. */
  queries?: string[];
  /** Embedding vectors — blocks closer to more vectors rank higher. */
  embeddings?: Float32Array[];
  /** Maximum number of results to return (total if ungrouped, per group if grouped). */
  topK: number;
  /** Relative weights for blending FTS and embedding scores. */
  weights?: HybridWeights;
  /** When true, results are grouped by document path in the output stream. */
  groupByPath?: boolean;
}

// =============================================================================
// 5. Search results
// =============================================================================

/**
 * A single result from a full-text search, extending the block reference
 * with a text snippet and relevance score.
 */
export interface FullTextSearchResult extends BlockReference {
  /** Text snippet from the matched block providing context around the match. */
  snippet: string;
  /** Relevance score — higher values indicate a better match. */
  score: number;
}

/**
 * A single result from a vector similarity search, extending the block
 * reference with a similarity score.
 */
export interface EmbeddingSearchResult extends BlockReference {
  /** Similarity score (e.g. cosine similarity) — higher values indicate closer matches. */
  score: number;
}

/**
 * A single result from a hybrid search, carrying the blended score as well
 * as the individual FTS and embedding sub-results (either of which may be
 * null if that modality was not used or did not match).
 */
export interface HybridSearchResult extends BlockReference {
  /** Combined score blending FTS and embedding scores according to {@link HybridWeights}. */
  score: number;
  /** The FTS sub-result, or null if this block was not matched by the FTS query. */
  fts: FullTextSearchResult | null;
  /** The embedding sub-result, or null if this block was not matched by vector search. */
  embedding: EmbeddingSearchResult | null;
}

// =============================================================================
// 7. Ranking primitive
// =============================================================================

/**
 * Minimal scored item — a block reference plus a score. Used by ranking
 * and reranking utilities (RRF in `@statewalker/indexer-core`, blend-with-
 * reranker in `@statewalker/indexer-search`) as a shared primitive.
 */
export interface ScoredItem {
  blockId: BlockId;
  score: number;
}

// =============================================================================
// 8. Embedding function
// =============================================================================

/**
 * Boundary type at which the application provides an embedding capability
 * to the indexer. Maps a piece of text to a dense float vector.
 */
export type EmbedFn = (text: string) => Promise<Float32Array>;
