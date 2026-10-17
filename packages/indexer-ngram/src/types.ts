import type {
  BlockReference,
  DocumentPath,
  Metadata,
  ScoredHit,
  SearchIndex,
} from "@statewalker/indexer-api";

/** Stable modality-type discriminator for the n-gram (grep) modality. */
export const NGRAM_TYPE = "ngram" as const;

/** A block of text for the n-gram sub-index. Matches never cross block boundaries. */
export interface NgramBlock extends BlockReference {
  content: string;
  metadata?: Metadata;
}

/**
 * N-gram sub-query: an exact pattern, literal by default.
 *
 * `regex: true` reads `pattern` as a JavaScript regular expression compiled
 * without the `u` flag (`.` is one UTF-16 code unit; `\u{…}` is not a
 * code-point escape); patterns containing `\p{` / `\P{` are rejected with a
 * `SyntaxError`. `caseSensitive` defaults to `true` (grep semantics). `topK`
 * (default 100) caps the returned blocks; `0` returns no hits. `topK` / `paths`
 * override the top-level request values for this sub-index. A backend may stop
 * early (a candidate budget — 10,000 in the SQLite backend); the search then
 * reports `truncated: true`, as it does when `topK` cut the result short.
 */
export interface NgramQuery {
  pattern: string;
  regex?: boolean;
  caseSensitive?: boolean;
  topK?: number;
  paths?: DocumentPath[];
}

/** One match: UTF-16 offsets into the block's content, `end` exclusive; `line` is 1-based. */
export interface NgramMatch {
  start: number;
  end: number;
  line: number;
}

/** A block with at least one match. `score` equals `count`. */
export interface NgramResult extends ScoredHit {
  count: number;
  matches: NgramMatch[];
}

/** Returned by `NgramIndex.search` when the generator finishes. */
export interface NgramSearchSummary {
  /** `true` when the candidate budget or `topK` cut the search short — results may be incomplete. */
  truncated: boolean;
}

export interface NgramIndexInfo {
  store: "fts5" | "postings";
  metadata?: Metadata;
}

/**
 * N-gram / regex sub-index. `search` yields hits and *returns* a summary;
 * `for await` drops the summary — use {@link grep} to read it.
 */
export interface NgramIndex extends SearchIndex<NgramBlock, NgramQuery, NgramResult> {
  search(params: NgramQuery): AsyncGenerator<NgramResult, NgramSearchSummary | undefined>;
  getIndexInfo(): Promise<NgramIndexInfo>;
}

/** Creation config. `store` picks the backend's candidate store; backends choose the default. */
export interface NgramConfig {
  store?: "fts5" | "postings";
  metadata?: Metadata;
}
