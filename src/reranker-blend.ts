/**
 * Position-aware reranker blending.
 *
 * Algorithm adapted from QMD (https://github.com/tobi/qmd) by Tobi Lutke.
 * MIT License — Copyright (c) 2024-2026 Tobi Lutke.
 */

import type { ScoredItem } from "./rrf.js";

export interface BlendTier {
  maxRank: number;
  retrievalWeight: number;
}

export const DEFAULT_BLEND_TIERS: BlendTier[] = [
  { maxRank: 3, retrievalWeight: 0.75 },
  { maxRank: 10, retrievalWeight: 0.6 },
  { maxRank: Infinity, retrievalWeight: 0.4 },
];

function getTier(rank: number, tiers: BlendTier[]): BlendTier {
  for (const tier of tiers) {
    if (rank <= tier.maxRank) return tier;
  }
  const last = tiers[tiers.length - 1];
  if (!last) throw new Error("BlendTier array must not be empty");
  return last;
}

export function blendWithReranker(
  retrievalResults: ScoredItem[],
  rerankScores: Map<string, number>,
  tiers: BlendTier[] = DEFAULT_BLEND_TIERS,
): ScoredItem[] {
  const blended = retrievalResults.map((result, i) => {
    const rank = i + 1;
    const retrievalScore = 1 / rank;
    const rerankScore = rerankScores.get(result.blockId) ?? 0;
    const tier = getTier(rank, tiers);
    const score =
      tier.retrievalWeight * retrievalScore +
      (1 - tier.retrievalWeight) * rerankScore;

    return { ...result, score };
  });

  blended.sort((a, b) => b.score - a.score);
  return blended;
}
