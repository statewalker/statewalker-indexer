/**
 * Enhanced Reciprocal Rank Fusion with weighted lists and top-rank bonus.
 *
 * Top-rank bonus adapted from QMD (https://github.com/tobi/qmd) by Tobi Lutke.
 * MIT License — Copyright (c) 2024-2026 Tobi Lutke.
 */

/** Minimal scored item — any object with blockId and score works. */
export interface ScoredItem {
  blockId: string;
  score: number;
}

export interface RankedList {
  results: ScoredItem[];
  weight?: number;
  meta?: { source: string; queryType: string; query: string };
}

export interface RRFContribution {
  listIndex: number;
  source?: string;
  queryType?: string;
  rank: number;
  weight: number;
  contribution: number;
}

export interface RRFTrace {
  contributions: RRFContribution[];
  baseScore: number;
  topRank: number;
  topRankBonus: number;
  totalScore: number;
}

const TOP_RANK_BONUSES: [number, number][] = [
  [1, 0.05],
  [3, 0.02],
];

function getTopRankBonus(rank: number): number {
  for (const [maxRank, bonus] of TOP_RANK_BONUSES) {
    if (rank <= maxRank) return bonus;
  }
  return 0;
}

export function reciprocalRankFusion(
  lists: RankedList[],
  topK: number,
  k = 60,
): ScoredItem[] {
  const scores = new Map<string, number>();
  const bestRank = new Map<string, number>();

  for (const list of lists) {
    const w = list.weight ?? 1.0;
    for (let i = 0; i < list.results.length; i++) {
      const result = list.results[i];
      if (!result) continue;
      const { blockId } = result;
      const contribution = w / (k + i + 1);
      scores.set(blockId, (scores.get(blockId) ?? 0) + contribution);

      const oneIndexedRank = i + 1;
      const prev = bestRank.get(blockId);
      if (prev === undefined || oneIndexedRank < prev) {
        bestRank.set(blockId, oneIndexedRank);
      }
    }
  }

  // Apply top-rank bonus
  for (const [blockId, rank] of bestRank) {
    const bonus = getTopRankBonus(rank);
    if (bonus > 0) {
      scores.set(blockId, (scores.get(blockId) ?? 0) + bonus);
    }
  }

  // Sort descending and slice
  const entries = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  return entries.slice(0, topK).map(([blockId, score]) => ({
    blockId,
    score,
  }));
}

export function buildRrfTrace(
  lists: RankedList[],
  k = 60,
): Map<string, RRFTrace> {
  const traces = new Map<string, RRFTrace>();

  function getOrCreate(blockId: string): RRFTrace {
    let trace = traces.get(blockId);
    if (!trace) {
      trace = {
        contributions: [],
        baseScore: 0,
        topRank: Number.POSITIVE_INFINITY,
        topRankBonus: 0,
        totalScore: 0,
      };
      traces.set(blockId, trace);
    }
    return trace;
  }

  for (let listIndex = 0; listIndex < lists.length; listIndex++) {
    const list = lists[listIndex];
    if (!list) continue;
    const w = list.weight ?? 1.0;

    for (let i = 0; i < list.results.length; i++) {
      const result = list.results[i];
      if (!result) continue;
      const { blockId } = result;
      const contribution = w / (k + i + 1);
      const oneIndexedRank = i + 1;

      const trace = getOrCreate(blockId);
      trace.baseScore += contribution;

      if (oneIndexedRank < trace.topRank) {
        trace.topRank = oneIndexedRank;
      }

      trace.contributions.push({
        listIndex,
        source: list.meta?.source,
        queryType: list.meta?.queryType,
        rank: oneIndexedRank,
        weight: w,
        contribution,
      });
    }
  }

  // Compute bonuses and totals
  for (const trace of traces.values()) {
    trace.topRankBonus = getTopRankBonus(trace.topRank);
    trace.totalScore = trace.baseScore + trace.topRankBonus;
  }

  return traces;
}
