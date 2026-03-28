import type { Index } from "./indexer-index.js";
import { type RankedList, reciprocalRankFusion } from "./rrf.js";
import type {
  BlockId,
  GroupedSearchResult,
  MultiSearchParams,
  MultiSearchResult,
  ScoredResult,
} from "./types.js";

/**
 * Default multiSearch implementation that works with any Index.
 * Fans out individual queries/embeddings, fuses with RRF, tracks matchCount.
 */
export async function defaultMultiSearch(
  index: Index,
  params: MultiSearchParams,
): Promise<MultiSearchResult> {
  const { queries, embeddings, topK, weights, collections, groupByCollection } =
    params;

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
        index.search({ query, topK, weights, collections }).then((results) => {
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
        index
          .search({ embedding, topK, weights, collections })
          .then((results) => {
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
  const matchCounts = new Map<BlockId, number>();
  for (const list of rankedLists) {
    const seen = new Set<BlockId>();
    for (const r of list.results) {
      if (!seen.has(r.blockId)) {
        seen.add(r.blockId);
        matchCounts.set(r.blockId, (matchCounts.get(r.blockId) ?? 0) + 1);
      }
    }
  }

  // Track collectionId from results
  const collectionMap = new Map<BlockId, string>();
  for (const list of rankedLists) {
    for (const r of list.results) {
      if (r.collectionId && !collectionMap.has(r.blockId)) {
        collectionMap.set(r.blockId, r.collectionId);
      }
    }
  }

  // Fuse with RRF
  const fused = reciprocalRankFusion(rankedLists, topK);

  // Build scored results
  const scored: ScoredResult[] = fused.map((r) => ({
    ...r,
    collectionId: collectionMap.get(r.blockId) ?? r.collectionId,
    matchCount: matchCounts.get(r.blockId) ?? 1,
  }));

  if (!groupByCollection) {
    return scored;
  }

  // Group by collection
  const groups = new Map<string, ScoredResult[]>();
  for (const r of scored) {
    const cid = r.collectionId ?? "_default";
    let group = groups.get(cid);
    if (!group) {
      group = [];
      groups.set(cid, group);
    }
    if (group.length < topK) {
      group.push(r);
    }
  }

  // Sort groups by best score
  const result: GroupedSearchResult[] = [...groups.entries()]
    .map(([collectionId, results]) => ({ collectionId, results }))
    .sort((a, b) => {
      const aScore = a.results[0]?.score ?? 0;
      const bScore = b.results[0]?.score ?? 0;
      return bScore - aScore;
    });

  return result;
}
