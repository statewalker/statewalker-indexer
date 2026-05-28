// =============================================================================
// Indexer Contract — Data Types (kernel)
//
// Modality-agnostic data shapes. Full-text / vector specific types live in
// `@statewalker/indexer-fulltext` and `@statewalker/indexer-vector`. Zero
// modality knowledge here.
//
// Logical layout:
//   1. Primitives        (DocumentPath, BlockId, Metadata)
//   2. References        (BlockReference, PathSelector)
//   3. Search request    (SearchRequest)
//   4. Search results    (ScoredHit, SearchResult)
//   5. Ranking primitive (ScoredItem)
//   6. Embed function    (EmbedFn)
// =============================================================================

// =============================================================================
// 1. Primitive types
// =============================================================================

/**
 * Hierarchical path identifying a document within the index.
 *
 * Must start with `"/"`. Paths act as grouping keys — all blocks sharing
 * the same path belong to the same logical document. Path prefixes are used
 * throughout the API for filtering (e.g. `"/docs/"` matches `"/docs/a"`).
 *
 * @example "/documents/readme/"
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
 * and block id. The one identity that crosses modality boundaries.
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
 */
export type PathSelector = {
  /** Path prefix selecting the target documents. */
  path: DocumentPath;
  /** Optional specific block to select; when omitted all blocks under `path`. */
  blockId?: BlockId;
};

// =============================================================================
// 3. Search request
// =============================================================================

/**
 * Top-level input to {@link Index.search}.
 *
 * Carries shared filters (`paths`, `topK`) plus a `subQueries` map keyed by
 * **sub-index name** holding modality-specific payloads. Presence of a name in
 * `subQueries` is what activates the corresponding sub-index. Use the kernel
 * helpers {@link setSubQuery} / {@link getSubQuery} or a modality Access handle
 * to read/write entries instead of mutating the map directly.
 *
 * `topK` is the final blended cutoff; `paths` is the default scope. Individual
 * sub-queries MAY override both for their own retrieval.
 */
export interface SearchRequest {
  /** Path prefixes to restrict the search scope. Defaults to the entire index. */
  paths?: DocumentPath[];
  /** Maximum number of blended results to return. */
  topK: number;
  /** Modality-specific sub-queries keyed by sub-index name. */
  subQueries?: Record<string, unknown>;
}

// =============================================================================
// 4. Search results
// =============================================================================

/**
 * Minimal modality-native hit: a block reference plus a native relevance score
 * (BM25 for FTS, cosine for vector, …). Every sub-index's result type extends
 * this, which lets the composite rank and fuse generically without knowing the
 * modality.
 */
export interface ScoredHit extends BlockReference {
  /** Modality-native score — higher is a better match. */
  score: number;
}

/**
 * Top-level output of {@link Index.search}.
 *
 * Carries `{path, blockId}` and the RRF **fusion** `score` only. Modality-native
 * scores and modality-specific fields (snippets, …) live in `subResults`, keyed
 * by **sub-index name**. Use the kernel helpers {@link setSubResult} /
 * {@link getSubResult} or a modality Access handle.
 */
export interface SearchResult extends BlockReference {
  /** RRF fusion score across all active sub-indexes — comparable only within one search. */
  score: number;
  /** Modality-native sub-results keyed by sub-index name. */
  subResults?: Record<string, unknown>;
}

// =============================================================================
// 5. Ranking primitive
// =============================================================================

/**
 * Minimal scored item — a block id plus a score. Shared primitive used by
 * ranking / reranking utilities (RRF in `@statewalker/indexer-core`, reranker
 * blending in `@statewalker/indexer-search`).
 */
export interface ScoredItem {
  blockId: BlockId;
  score: number;
}

// =============================================================================
// 6. Embedding function
// =============================================================================

/**
 * Boundary type at which the application provides an embedding capability to
 * the indexer. Maps a piece of text to a dense float vector.
 */
export type EmbedFn = (text: string) => Promise<Float32Array>;
