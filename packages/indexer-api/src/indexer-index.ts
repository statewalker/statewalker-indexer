// =============================================================================
// Indexer Index API
//
// Defines the core abstractions for a hybrid search index combining full-text
// search (FTS) and vector/embedding search. The index organises content into
// documents identified by hierarchical paths (DocumentPath) and blocks within
// those documents (BlockId). Each block may carry text content, an embedding
// vector, or both.
//
// Logical layout:
//   1. Primitive types  (DocumentPath, BlockId, Metadata)
//   2. References       (BlockReference, PathSelector)
//   3. Block types      (IndexedBlock, FullTextBlock, EmbeddingBlock)
//   4. Search params    (FullTextSearchParams, EmbeddingSearchParams, HybridSearchParams)
//   5. Search results   (FullTextSearchResult, EmbeddingSearchResult, HybridSearchResult)
//   6. Generic base     (SearchIndex<B, P, R>)
//   7. Sub-indexes      (FullTextIndex, EmbeddingIndex)
//   8. Composite index  (Index)
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
 * A block of content to be added to the hybrid {@link Index}.
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
// 6. Generic search index base
// =============================================================================

/**
 * Abstract base interface for all search indexes (FTS, embedding, hybrid).
 *
 * Provides a uniform contract for:
 * - **Searching** — streaming results via an async generator.
 * - **Ingestion** — adding documents as batches of blocks.
 * - **Deletion** — removing documents by path prefix / block id.
 * - **Enumeration** — listing paths, block references, and full blocks.
 * - **Lifecycle** — flushing pending writes, closing, and destroying the index.
 *
 * @typeParam BlockType        The block shape accepted for ingestion.
 * @typeParam SearchParamsType  The search parameters accepted by this index.
 * @typeParam SearchResultType  The shape of individual search results.
 */
interface SearchIndex<BlockType, SearchParamsType, SearchResultType> {
  // --- Search ----------------------------------------------------------------

  /**
   * Execute a search and stream results as an async generator.
   *
   * @param params  Search parameters specific to the index type.
   * @returns An async generator yielding scored search results.
   */
  search(params: SearchParamsType): AsyncGenerator<SearchResultType>;

  // --- Ingestion -------------------------------------------------------------

  /**
   * Add a single document's blocks to the index.
   *
   * All blocks in the array **must** share the same {@link DocumentPath}.
   * To ingest blocks from different documents use {@link addDocuments} or
   * call this method once per document.
   */
  addDocument(blocks: BlockType[]): Promise<void>;

  /**
   * Bulk-add documents from a (possibly async) iterable of block batches.
   *
   * Each inner array represents one document and **must** contain blocks
   * sharing the same {@link DocumentPath}.
   */
  addDocuments(blocks: Iterable<BlockType[]> | AsyncIterable<BlockType[]>): Promise<void>;

  // --- Deletion --------------------------------------------------------------

  /**
   * Delete blocks matching the given path selectors.
   *
   * Each selector targets a path prefix and optionally a specific block id.
   * Accepts either an array (for known-size batches) or an async iterable
   * (for streaming deletion lists).
   */
  deleteDocuments(pathSelectors: PathSelector[] | AsyncIterable<PathSelector>): Promise<void>;

  // --- Enumeration -----------------------------------------------------------

  /**
   * Count the number of blocks in the index.
   *
   * @param pathPrefix  When provided, only blocks under this prefix are counted.
   */
  getSize(pathPrefix?: DocumentPath): Promise<number>;

  /**
   * Stream all unique document paths in the index.
   *
   * @param pathPrefix  When provided, only paths under this prefix are yielded.
   * @returns An async generator yielding unique {@link DocumentPath} values.
   */
  getDocumentPaths(pathPrefix?: DocumentPath): AsyncGenerator<DocumentPath>;

  /**
   * Stream all block references (path + blockId) in the index.
   *
   * @param pathPrefix  When provided, only blocks under this prefix are yielded.
   */
  getDocumentBlocksRefs(pathPrefix?: DocumentPath): AsyncGenerator<BlockReference>;

  /**
   * Stream all blocks (with full content / embedding data) in the index.
   *
   * @param pathPrefix  When provided, only blocks under this prefix are yielded.
   */
  getDocumentsBlocks(pathPrefix?: DocumentPath): AsyncGenerator<BlockType>;

  // --- Lifecycle -------------------------------------------------------------

  /**
   * Close the index and release associated resources.
   *
   * @param options.force  When `true`, pending writes may be discarded
   *   without flushing. Defaults to `false` (flush before closing).
   */
  close(options?: { force?: boolean }): Promise<void>;

  /**
   * Flush pending writes so that all previously added blocks become
   * searchable. Important for indexes with delayed or batched indexing.
   */
  flush(): Promise<void>;

  /**
   * Permanently delete the entire index and all its contents.
   *
   * This operation is **irreversible**. After calling `deleteIndex` the
   * instance should be considered unusable until re-initialised.
   */
  deleteIndex(): Promise<void>;
}

// =============================================================================
// 7. Sub-indexes
// =============================================================================

/** Configuration / status information for a full-text sub-index. */
export interface FullTextIndexInfo {
  /** Language used for stemming, stop-words, etc. */
  language: string;
  /** Optional index-level metadata. */
  metadata?: Metadata;
}

/**
 * Full-text search sub-index operating on {@link FullTextBlock}s.
 *
 * Supports multi-query FTS with path-prefix filtering and relevance scoring.
 */
export interface FullTextIndex
  extends SearchIndex<FullTextBlock, FullTextSearchParams, FullTextSearchResult> {
  /** Retrieve configuration and status information for this FTS index. */
  getIndexInfo(): Promise<FullTextIndexInfo>;
}

/** Configuration / status information for an embedding sub-index. */
export interface EmbeddingIndexInfo {
  /** Dimensionality of the embedding vectors stored in this index. */
  dimensionality: number;
  /** Name or identifier of the embedding model that produced the vectors. */
  model: string;
  /** Optional index-level metadata. */
  metadata?: Metadata;
}

/**
 * Vector / embedding search sub-index operating on {@link EmbeddingBlock}s.
 *
 * Supports multi-vector similarity search with path-prefix filtering.
 */
export interface EmbeddingIndex
  extends SearchIndex<EmbeddingBlock, EmbeddingSearchParams, EmbeddingSearchResult> {
  /** Retrieve configuration and status information for this vector index. */
  getIndexInfo(): Promise<EmbeddingIndexInfo>;
}

// =============================================================================
// 8. Composite hybrid index
// =============================================================================

/**
 * A named hybrid search index combining optional FTS and vector sub-indexes.
 *
 * The composite {@link Index} accepts {@link IndexedBlock}s (which may carry
 * text, an embedding, or both) and routes them to the appropriate sub-indexes.
 * Hybrid search blends results from both modalities according to
 * {@link HybridWeights}.
 */
export interface Index extends SearchIndex<IndexedBlock, HybridSearchParams, HybridSearchResult> {
  /** Unique name of this index within the {@link Indexer}. */
  readonly name: string;
  /** Optional index-level metadata. */
  readonly metadata?: Metadata;

  /** Returns the FTS sub-index, or `null` if this index has no full-text capability. */
  getFullTextIndex(): FullTextIndex | null;

  /** Returns the vector sub-index, or `null` if this index has no embedding capability. */
  getVectorIndex(): EmbeddingIndex | null;
}
