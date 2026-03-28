import type { SearchResult } from "@repo/indexer-api";

export function mergeByRRF(
  ftsResults: SearchResult[],
  vectorResults: SearchResult[],
  topK: number,
  k = 60,
): SearchResult[] {
  const scores = new Map<string, number>();
  const collectionIds = new Map<string, string>();

  for (let i = 0; i < ftsResults.length; i++) {
    const r = ftsResults[i];
    if (!r) continue;
    scores.set(r.blockId, (scores.get(r.blockId) ?? 0) + 1 / (k + i + 1));
    if (r.collectionId && !collectionIds.has(r.blockId)) {
      collectionIds.set(r.blockId, r.collectionId);
    }
  }
  for (let i = 0; i < vectorResults.length; i++) {
    const r = vectorResults[i];
    if (!r) continue;
    scores.set(r.blockId, (scores.get(r.blockId) ?? 0) + 1 / (k + i + 1));
    if (r.collectionId && !collectionIds.has(r.blockId)) {
      collectionIds.set(r.blockId, r.collectionId);
    }
  }

  const results: SearchResult[] = [];
  for (const [blockId, score] of scores) {
    const collectionId = collectionIds.get(blockId);
    results.push({ blockId, score, ...(collectionId ? { collectionId } : {}) });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

export function mergeByWeights(
  ftsResults: SearchResult[],
  vectorResults: SearchResult[],
  weights: { fts: number; embedding: number },
  topK: number,
): SearchResult[] {
  // Min-max normalization
  const normalize = (results: SearchResult[]): Map<string, number> => {
    const map = new Map<string, number>();
    if (results.length === 0) return map;
    let min = Infinity;
    let max = -Infinity;
    for (const r of results) {
      if (r.score < min) min = r.score;
      if (r.score > max) max = r.score;
    }
    const range = max - min;
    for (const r of results) {
      map.set(r.blockId, range === 0 ? 1 : (r.score - min) / range);
    }
    return map;
  };

  const ftsNorm = normalize(ftsResults);
  const vecNorm = normalize(vectorResults);

  const allBlockIds = new Set<string>();
  const collectionIds = new Map<string, string>();
  for (const r of ftsResults) {
    allBlockIds.add(r.blockId);
    if (r.collectionId && !collectionIds.has(r.blockId)) {
      collectionIds.set(r.blockId, r.collectionId);
    }
  }
  for (const r of vectorResults) {
    allBlockIds.add(r.blockId);
    if (r.collectionId && !collectionIds.has(r.blockId)) {
      collectionIds.set(r.blockId, r.collectionId);
    }
  }

  const results: SearchResult[] = [];
  for (const blockId of allBlockIds) {
    const ftsScore = (ftsNorm.get(blockId) ?? 0) * weights.fts;
    const vecScore = (vecNorm.get(blockId) ?? 0) * weights.embedding;
    const collectionId = collectionIds.get(blockId);
    results.push({
      blockId,
      score: ftsScore + vecScore,
      ...(collectionId ? { collectionId } : {}),
    });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}
