// =============================================================================
// Weighted blend — caller-side reranker over already-RRF-blended SearchResults.
//
// Reads each sub-result via `getSubResult<R>(result, name)`, min-max normalises
// the native scores per sub-index name, and reorders by a weighted sum keyed by
// the same names. Ported from the retired core-level `mergeByWeights`, re-typed
// against the open-registry contract (per-name weights, sub-results on results).
// =============================================================================

import { getSubResult, type SearchResult } from "@statewalker/indexer-api";

/** Per-sub-index-name weight map, e.g. `{ q: 0.7, semantic: 0.3 }`. */
export type WeightedBlendWeights = Record<string, number>;

export interface WeightedBlendOptions {
  /** Truncate to this many results after sorting; defaults to no truncation. */
  topK?: number;
}

/**
 * Reorder `results` by a weighted blend of per-name normalised native scores.
 *
 * For each name in `weights`, every result's sub-result is read via
 * `getSubResult`. Its `score` (modality-native) is min-max normalised across
 * the input set; missing sub-results count as `0`. The final score per result
 * is `sum_over_names(weight[name] * normalised[name])`.
 *
 * When every native score for a given name is equal, min-max normalisation is
 * undefined — fall back to position decay (`1 / (i+1)`) so original ranking
 * survives the blend.
 */
export function weightedBlend(
  results: SearchResult[],
  weights: WeightedBlendWeights,
  options?: WeightedBlendOptions,
): SearchResult[] {
  const names = Object.keys(weights);
  const normalisedByName = new Map<string, number[]>();

  for (const name of names) {
    const nativeScores: number[] = [];
    for (const result of results) {
      const sub = getSubResult<{ score: number }>(result, name);
      nativeScores.push(sub?.score ?? 0);
    }
    normalisedByName.set(name, normalise(nativeScores));
  }

  const blended = results.map((result, i) => {
    let score = 0;
    for (const name of names) {
      const normalised = normalisedByName.get(name)?.[i] ?? 0;
      score += (weights[name] ?? 0) * normalised;
    }
    return { ...result, score };
  });

  blended.sort((a, b) => b.score - a.score);
  return options?.topK !== undefined ? blended.slice(0, options.topK) : blended;
}

function normalise(scores: number[]): number[] {
  if (scores.length === 0) return [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const s of scores) {
    if (s < min) min = s;
    if (s > max) max = s;
  }
  const range = max - min;
  // When every input scored equally, min-max normalisation is undefined.
  // Falling back to 1.0 for every entry erases retrieval ranking; synthesise
  // a decaying score from the original position so upstream order survives.
  return scores.map((s, i) => (range === 0 ? 1 / (i + 1) : (s - min) / range));
}
