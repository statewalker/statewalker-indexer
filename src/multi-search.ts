import type {
  DocumentPath,
  HybridSearchResult,
  HybridWeights,
  Index,
} from "./indexer-index.js";
import {
  type RankedList,
  reciprocalRankFusion,
  type ScoredItem,
} from "./rrf.js";

/** Collect all results from an async generator into an array. */
async function collectResults(
  gen: AsyncGenerator<HybridSearchResult>,
): Promise<HybridSearchResult[]> {
  const results: HybridSearchResult[] = [];
  for await (const r of gen) {
    results.push(r);
  }
  return results;
}

/** Parameters for multi-query search with RRF fusion. */
export interface MultiSearchParams {
  /** FTS queries — blocks matching more queries rank higher. */
  queries?: string[];
  /** Embedding vectors — blocks closer to more vectors rank higher. */
  embeddings?: Float32Array[];
  /** Maximum number of results to return. */
  topK: number;
  /** Relative weights for blending FTS and embedding scores. */
  weights?: HybridWeights;
  /** Path prefixes to restrict search scope. */
  paths?: DocumentPath[];
}

/** A scored result with cross-query match count. */
export interface MultiSearchResult extends ScoredItem {
  /** How many of the input queries matched this block. */
  matchCount: number;
}

/**
 * Multi-query search utility that fans out individual queries/embeddings
 * to the index, fuses results with RRF, and tracks matchCount.
 */
export async function defaultMultiSearch(
  index: Index,
  params: MultiSearchParams,
): Promise<MultiSearchResult[]> {
  const { queries, embeddings, topK, weights, paths } = params;

  const hasQueries = queries && queries.length > 0;
  const hasEmbeddings = embeddings && embeddings.length > 0;

  if (!hasQueries && !hasEmbeddings) {
    return [];
  }

  // Fan out: run each query/embedding independently
  const rankedLists: RankedList[] = [];
  const searchPromises: Promise<void>[] = [];

  if (hasQueries) {
    for (const query of queries) {
      searchPromises.push(
        collectResults(
          index.search({ queries: [query], topK, weights, paths }),
        ).then((hybridResults) => {
          const results = hybridResults.map((r) => ({
            blockId: r.blockId,
            score: r.score,
          }));
          rankedLists.push({
            results,
            meta: { source: "fts", queryType: "lex", query },
          });
        }),
      );
    }
  }

  if (hasEmbeddings) {
    for (const embedding of embeddings) {
      searchPromises.push(
        collectResults(
          index.search({ embeddings: [embedding], topK, weights, paths }),
        ).then((hybridResults) => {
          const results = hybridResults.map((r) => ({
            blockId: r.blockId,
            score: r.score,
          }));
          rankedLists.push({
            results,
            meta: { source: "vec", queryType: "vec", query: "" },
          });
        }),
      );
    }
  }

  await Promise.all(searchPromises);

  // Track which queries matched each document
  const matchCounts = new Map<string, number>();
  for (const list of rankedLists) {
    const seen = new Set<string>();
    for (const r of list.results) {
      if (!seen.has(r.blockId)) {
        seen.add(r.blockId);
        matchCounts.set(r.blockId, (matchCounts.get(r.blockId) ?? 0) + 1);
      }
    }
  }

  // Fuse with RRF
  const fused = reciprocalRankFusion(rankedLists, topK);

  return fused.map((r) => ({
    blockId: r.blockId,
    score: r.score,
    matchCount: matchCounts.get(r.blockId) ?? 1,
  }));
}
