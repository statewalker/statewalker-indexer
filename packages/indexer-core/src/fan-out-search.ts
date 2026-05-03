import type {
  DocumentPath,
  HybridSearchResult,
  HybridWeights,
  Index,
  ScoredItem,
} from "@statewalker/indexer-api";
import { type RankedList, reciprocalRankFusion } from "./rrf.js";

/** Parameters for fan-out search with cross-query RRF fusion. */
export interface FanOutSearchParams {
  /** FTS queries — blocks matching more queries rank higher. */
  queries?: string[];
  /** Embedding vectors — blocks closer to more vectors rank higher. */
  embeddings?: Float32Array[];
  /** Maximum number of results to return. */
  topK: number;
  /** Relative weights for blending FTS and embedding scores within each per-query call. */
  weights?: HybridWeights;
  /** Path prefixes to restrict search scope. */
  paths?: DocumentPath[];
}

async function collectResults(
  gen: AsyncGenerator<HybridSearchResult>,
): Promise<HybridSearchResult[]> {
  const results: HybridSearchResult[] = [];
  for await (const r of gen) {
    results.push(r);
  }
  return results;
}

/**
 * Backend-implementation glue: fans out individual queries/embeddings to
 * `index.search()`, then fuses the resulting ranked lists with RRF.
 *
 * Use this when an underlying engine has no native multi-query merge — the
 * backend can call `fanOutSearch` from inside its own `Index.search()` to
 * obtain cross-query rank fusion.
 *
 * Not part of any consumer-facing public surface. The `SearchPipeline` in
 * `@statewalker/indexer-search` delegates fusion to `index.search()`
 * directly and does not need this helper.
 */
export async function fanOutSearch(
  index: Index,
  params: FanOutSearchParams,
): Promise<ScoredItem[]> {
  const { queries, embeddings, topK, weights, paths } = params;

  const hasQueries = queries && queries.length > 0;
  const hasEmbeddings = embeddings && embeddings.length > 0;

  if (!hasQueries && !hasEmbeddings) {
    return [];
  }

  const rankedLists: RankedList[] = [];
  const searchPromises: Promise<void>[] = [];

  if (hasQueries) {
    for (const query of queries) {
      searchPromises.push(
        collectResults(index.search({ queries: [query], topK, weights, paths })).then(
          (hybridResults) => {
            rankedLists.push({
              results: hybridResults.map((r) => ({ blockId: r.blockId, score: r.score })),
              meta: { source: "fts", queryType: "lex", query },
            });
          },
        ),
      );
    }
  }

  if (hasEmbeddings) {
    for (const embedding of embeddings) {
      searchPromises.push(
        collectResults(index.search({ embeddings: [embedding], topK, weights, paths })).then(
          (hybridResults) => {
            rankedLists.push({
              results: hybridResults.map((r) => ({ blockId: r.blockId, score: r.score })),
              meta: { source: "vec", queryType: "vec", query: "" },
            });
          },
        ),
      );
    }
  }

  await Promise.all(searchPromises);

  return reciprocalRankFusion(rankedLists, topK);
}
