/** Opaque string identifier for a content block */
export type BlockId = string;

/** Arbitrary metadata attached to indexes or documents */
export type Metadata = Record<string, unknown>;

/** A single search result */
export interface SearchResult {
  blockId: BlockId;
  score: number;
}

/** Weights for hybrid search combining FTS and vector results */
export interface HybridWeights {
  fts: number;
  embedding: number;
}
