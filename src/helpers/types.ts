import type { BlockId } from "../indexer-index.js";
import type { QueryType } from "../query-parser.js";
import type { ScoredItem } from "../rrf.js";

export interface ExpandedQuery {
  type: QueryType;
  query: string;
}

export interface RerankResult {
  blockId: BlockId;
  score: number;
}

export interface Citation {
  blockId: BlockId;
  snippet: string;
  relevance: number;
  context?: string;
}

export type QueryExpanderFn = (
  query: string,
  options?: {
    intent?: string;
    maxVariations?: number;
  },
) => Promise<ExpandedQuery[]>;

export type RerankerFn = (
  query: string,
  candidates: Array<{ blockId: BlockId; text: string }>,
  options?: { topK?: number },
) => Promise<RerankResult[]>;

export type CitationBuilderFn = (
  query: string,
  results: ScoredItem[],
  getContent: (blockId: BlockId) => Promise<string>,
  options?: { maxCitations?: number },
) => Promise<Citation[]>;
