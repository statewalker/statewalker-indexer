import type {
  BlockReference,
  DocumentPath,
  Metadata,
  ScoredHit,
  SearchIndex,
} from "@statewalker/indexer-api";

/**
 * A block carrying an embedding vector for the vector sub-index. `embedding`
 * is required — a vector index cannot operate without a vector.
 */
export interface VectorBlock extends BlockReference {
  /** Dense float vector representing this block's content. */
  embedding: Float32Array;
  /** Optional metadata stored alongside the block. */
  metadata?: Metadata;
}

/**
 * Vector sub-query carried by a `SearchRequest` under a sub-index name.
 *
 * `topK` and `paths` here override the top-level request values for this
 * sub-index's retrieval; the composite still truncates the fused output to
 * top-level `topK`.
 */
export interface VectorQuery {
  /** Embedding vectors — blocks closer to more vectors rank higher. */
  embeddings: Float32Array[];
  /** Override the top-level retrieval depth for this sub-index. */
  topK?: number;
  /** Override the top-level path scope for this sub-index. */
  paths?: DocumentPath[];
}

/**
 * Per-document hit produced by the vector sub-index. Carries the modality-
 * native similarity score (e.g. cosine).
 */
export type VectorResult = ScoredHit;

/** Configuration / status information for a vector sub-index. */
export interface VectorIndexInfo {
  /** Dimensionality of the embedding vectors stored in this index. */
  dimensionality: number;
  /** Name or identifier of the embedding model that produced the vectors. */
  model: string;
  /** Optional index-level metadata. */
  metadata?: Metadata;
}

/**
 * Vector / embedding sub-index. Extends the kernel `SearchIndex` base with a
 * configuration-introspection method.
 */
export interface VectorIndex extends SearchIndex<VectorBlock, VectorQuery, VectorResult> {
  /** Retrieve configuration and status information for this vector index. */
  getIndexInfo(): Promise<VectorIndexInfo>;
}

/** Creation config for the vector sub-index. */
export interface VectorConfig {
  /** Dimensionality of the embedding vectors. */
  dimensionality: number;
  /** Name or identifier of the embedding model that produced the vectors. */
  model: string;
  /** Optional index-level metadata. */
  metadata?: Metadata;
}

/** Stable modality-type discriminator for the vector modality. */
export const VECTOR_TYPE = "vector" as const;
