// =============================================================================
// Indexer Contract — Operation Interfaces
//
// Defines the operation shapes implemented by every backend: the generic
// `SearchIndex` base, the FTS / vector sub-indexes, and the composite
// hybrid `Index`. Zero runtime.
// =============================================================================

import type {
  BlockReference,
  DocumentPath,
  EmbeddingBlock,
  EmbeddingSearchParams,
  EmbeddingSearchResult,
  FullTextBlock,
  FullTextSearchParams,
  FullTextSearchResult,
  HybridSearchParams,
  HybridSearchResult,
  IndexedBlock,
  Metadata,
  PathSelector,
} from "./types.js";

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
 * @typeParam BlockType         The block shape accepted for ingestion.
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
 * `HybridWeights`.
 */
export interface Index extends SearchIndex<IndexedBlock, HybridSearchParams, HybridSearchResult> {
  /** Unique name of this index within the indexer. */
  readonly name: string;
  /** Optional index-level metadata. */
  readonly metadata?: Metadata;

  /** Returns the FTS sub-index, or `null` if this index has no full-text capability. */
  getFullTextIndex(): FullTextIndex | null;

  /** Returns the vector sub-index, or `null` if this index has no embedding capability. */
  getVectorIndex(): EmbeddingIndex | null;
}
