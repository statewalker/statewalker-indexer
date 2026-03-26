/** Opaque string identifier for a content block */
export type BlockId = string;

/** Identifier for a collection within an index */
export type CollectionId = string;

/** Default collection used when no collectionId is specified */
export const DEFAULT_COLLECTION: CollectionId = "_default";

/** Filter for specifying which collections to search */
export type CollectionFilter = CollectionId | CollectionId[];

/** Arbitrary metadata attached to indexes or documents */
export type Metadata = Record<string, unknown>;

/** A single search result */
export interface SearchResult {
  blockId: BlockId;
  score: number;
  collectionId?: CollectionId;
}

/** Weights for hybrid search combining FTS and vector results */
export interface HybridWeights {
  fts: number;
  embedding: number;
}
