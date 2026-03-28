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

/** Parameters for multi-query search */
export interface MultiSearchParams {
  /** Collection filters (exact IDs or prefixes ending with "/") */
  collections?: CollectionFilter;
  /** Multiple FTS queries ��� results matching more queries rank higher */
  queries?: string[];
  /** Multiple embedding vectors — same boosting logic */
  embeddings?: Float32Array[];
  /** Number of results to return (total if ungrouped, per group if grouped) */
  topK: number;
  /** Hybrid weights (FTS vs embedding) */
  weights?: HybridWeights;
  /** Group results by collection in output */
  groupByCollection?: boolean;
}

/** A search result with cross-query match count */
export interface ScoredResult extends SearchResult {
  /** How many of the input queries matched this document */
  matchCount: number;
}

/** Results grouped by collection */
export interface GroupedSearchResult {
  collectionId: CollectionId;
  results: ScoredResult[];
}

/** MultiSearch returns either flat scored results or grouped results */
export type MultiSearchResult = ScoredResult[] | GroupedSearchResult[];
