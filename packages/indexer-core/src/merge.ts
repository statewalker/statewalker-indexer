import type {
  DocumentPath,
  EmbeddingSearchResult,
  FullTextSearchResult,
  HybridSearchResult,
  HybridWeights,
} from "@statewalker/indexer-api";
import { compositeKey } from "./composite-key.js";

export function mergeByRRF(
  ftsResults: FullTextSearchResult[],
  vecResults: EmbeddingSearchResult[],
  topK: number,
  k = 60,
): HybridSearchResult[] {
  const scores = new Map<string, number>();
  const ftsMap = new Map<string, FullTextSearchResult>();
  const vecMap = new Map<string, EmbeddingSearchResult>();
  const pathMap = new Map<string, DocumentPath>();
  const blockIdMap = new Map<string, string>();

  for (let i = 0; i < ftsResults.length; i++) {
    const r = ftsResults[i];
    if (!r) continue;
    const key = compositeKey(r.path, r.blockId);
    scores.set(key, (scores.get(key) ?? 0) + 1 / (k + i + 1));
    ftsMap.set(key, r);
    pathMap.set(key, r.path);
    blockIdMap.set(key, r.blockId);
  }
  for (let i = 0; i < vecResults.length; i++) {
    const r = vecResults[i];
    if (!r) continue;
    const key = compositeKey(r.path, r.blockId);
    scores.set(key, (scores.get(key) ?? 0) + 1 / (k + i + 1));
    vecMap.set(key, r);
    if (!pathMap.has(key)) pathMap.set(key, r.path);
    if (!blockIdMap.has(key)) blockIdMap.set(key, r.blockId);
  }

  const results: HybridSearchResult[] = [];
  for (const [key, score] of scores) {
    results.push({
      path: pathMap.get(key) as DocumentPath,
      blockId: blockIdMap.get(key) as string,
      score,
      fts: ftsMap.get(key) ?? null,
      embedding: vecMap.get(key) ?? null,
    });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

export function mergeByWeights(
  ftsResults: FullTextSearchResult[],
  vecResults: EmbeddingSearchResult[],
  weights: HybridWeights,
  topK: number,
): HybridSearchResult[] {
  const normalize = (results: Array<{ score: number }>): Map<number, number> => {
    const map = new Map<number, number>();
    if (results.length === 0) return map;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const r of results) {
      if (r.score < min) min = r.score;
      if (r.score > max) max = r.score;
    }
    const range = max - min;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r) continue;
      map.set(i, range === 0 ? 1 : (r.score - min) / range);
    }
    return map;
  };

  const ftsNorm = normalize(ftsResults);
  const vecNorm = normalize(vecResults);

  const allKeys = new Map<
    string,
    {
      path: DocumentPath;
      blockId: string;
      fts: FullTextSearchResult | null;
      embedding: EmbeddingSearchResult | null;
    }
  >();

  const ftsScoreMap = new Map<string, number>();
  const vecScoreMap = new Map<string, number>();

  for (let i = 0; i < ftsResults.length; i++) {
    const r = ftsResults[i];
    if (!r) continue;
    const key = compositeKey(r.path, r.blockId);
    if (!allKeys.has(key)) {
      allKeys.set(key, {
        path: r.path,
        blockId: r.blockId,
        fts: r,
        embedding: null,
      });
    }
    ftsScoreMap.set(key, ftsNorm.get(i) ?? 0);
  }
  for (let i = 0; i < vecResults.length; i++) {
    const r = vecResults[i];
    if (!r) continue;
    const key = compositeKey(r.path, r.blockId);
    const existing = allKeys.get(key);
    if (existing) {
      existing.embedding = r;
    } else {
      allKeys.set(key, {
        path: r.path,
        blockId: r.blockId,
        fts: null,
        embedding: r,
      });
    }
    vecScoreMap.set(key, vecNorm.get(i) ?? 0);
  }

  const results: HybridSearchResult[] = [];
  for (const [key, entry] of allKeys) {
    const ftsScore = (ftsScoreMap.get(key) ?? 0) * weights.fts;
    const vecScore = (vecScoreMap.get(key) ?? 0) * weights.embedding;
    results.push({
      ...entry,
      score: ftsScore + vecScore,
    });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

export function mergeHybrid(
  ftsResults: FullTextSearchResult[],
  vecResults: EmbeddingSearchResult[],
  topK: number,
  weights?: HybridWeights,
): HybridSearchResult[] {
  return weights
    ? mergeByWeights(ftsResults, vecResults, weights, topK)
    : mergeByRRF(ftsResults, vecResults, topK);
}
