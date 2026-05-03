import type { BlockId, ScoredItem } from "@statewalker/indexer-api";
import type { QueryType } from "./query-parser.js";

export interface ExpandedQuery {
  type: QueryType;
  query: string;
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
) => Promise<ScoredItem[]>;

export type CitationBuilderFn = (
  query: string,
  results: ScoredItem[],
  getContent: (blockId: BlockId) => Promise<string>,
  options?: { maxCitations?: number },
) => Promise<Citation[]>;
