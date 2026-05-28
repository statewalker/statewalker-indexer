// Runtime: name-parametric helpers for sub-queries and sub-results.
export { getSubQuery, getSubResult, setSubQuery, setSubResult } from "./contract/helpers.js";
// Kernel contract types.
export type {
  AnySubIndexBinding,
  Index,
  ModalityProvider,
  PersistableSearchIndex,
  SearchIndex,
  SubIndexBinding,
} from "./contract/index.js";
// Runtime: structural check for the optional persistence opt-in.
export { isPersistable } from "./contract/index.js";
export type {
  BlockId,
  BlockReference,
  DocumentPath,
  EmbedFn,
  Metadata,
  PathSelector,
  ScoredHit,
  ScoredItem,
  SearchRequest,
  SearchResult,
} from "./contract/types.js";
export type {
  CreateIndexParams,
  GetIndexOptions,
  Indexer,
  IndexInfo,
  LoadAction,
} from "./indexer.js";
export type { IndexerPersistence, PersistenceEntry } from "./persistence.js";
