import type {
  BlockReference,
  DocumentPath,
  Metadata,
  ScoredHit,
  SearchIndex,
} from "@statewalker/indexer-api";

/**
 * A block of text content for the full-text sub-index. Unlike a kernel
 * `BlockReference`, `content` is required — the FTS index cannot operate
 * without text.
 */
export interface FullTextBlock extends BlockReference {
  /** The text content to be indexed for full-text search. */
  content: string;
  /** Optional metadata stored alongside the block. */
  metadata?: Metadata;
}

/**
 * Full-text sub-query carried by a `SearchRequest` under a sub-index name.
 *
 * `topK` and `paths` here override the top-level request values for this
 * sub-index's retrieval; the composite still truncates the fused output to
 * top-level `topK`.
 */
export interface FulltextQuery {
  /** FTS queries — blocks matching more queries rank higher. */
  queries: string[];
  /** Override the top-level retrieval depth for this sub-index. */
  topK?: number;
  /** Override the top-level path scope for this sub-index. */
  paths?: DocumentPath[];
}

/**
 * Per-document hit produced by the full-text sub-index. Carries the BM25-style
 * native score and a text snippet around the match.
 */
export interface FulltextResult extends ScoredHit {
  /** Text snippet from the matched block providing context. */
  snippet: string;
}

/** Configuration / status information for a full-text sub-index. */
export interface FullTextIndexInfo {
  /** Language used for stemming, stop-words, etc. */
  language: string;
  /** Optional index-level metadata. */
  metadata?: Metadata;
}

/**
 * Full-text search sub-index. Extends the kernel `SearchIndex` base with a
 * configuration-introspection method.
 */
export interface FullTextIndex extends SearchIndex<FullTextBlock, FulltextQuery, FulltextResult> {
  /** Retrieve configuration and status information for this FTS index. */
  getIndexInfo(): Promise<FullTextIndexInfo>;
}

/** Creation config for the full-text sub-index. */
export interface FullTextConfig {
  /** Language used for stemming, stop-words, etc. */
  language: string;
  /** Optional index-level metadata. */
  metadata?: Metadata;
}

/** Stable modality-type discriminator for the full-text modality. */
export const FULL_TEXT_TYPE = "fulltext" as const;
