/**
 * Intent-based disambiguation for search queries.
 *
 * Adapted from QMD (https://github.com/tobi/qmd) by Tobi Lutke.
 * MIT License — Copyright (c) 2024-2026 Tobi Lutke.
 * See: test/intent.test.ts, src/store.ts (extractIntentTerms, extractSnippet)
 */

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "must",
  "need",
  "of",
  "in",
  "to",
  "for",
  "with",
  "on",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "under",
  "about",
  "against",
  "over",
  "and",
  "or",
  "but",
  "nor",
  "not",
  "so",
  "yet",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "he",
  "she",
  "they",
  "what",
  "which",
  "who",
  "whom",
  "how",
  "when",
  "where",
  "why",
]);

export function extractIntentTerms(intent: string): string[] {
  const words = intent.toLowerCase().split(/[\s,.;:!?()[\]{}"']+/);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const w of words) {
    if (w && !STOP_WORDS.has(w) && !seen.has(w)) {
      seen.add(w);
      result.push(w);
    }
  }
  return result;
}

export interface ChunkSelection {
  chunk: string;
  index: number;
  score: number;
}

export function selectBestChunk(
  chunks: string[],
  queryTerms: string[],
  intentTerms?: string[],
  intentWeight?: number,
): ChunkSelection | undefined {
  if (chunks.length === 0) return undefined;
  const iw = intentWeight ?? 0.5;
  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;
    const lower = chunk.toLowerCase();
    let score = 0;
    for (const t of queryTerms) {
      if (lower.includes(t.toLowerCase())) score += 1;
    }
    if (intentTerms) {
      for (const t of intentTerms) {
        if (lower.includes(t.toLowerCase())) score += iw;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  const best = chunks[bestIndex];
  if (!best) return undefined;
  return { chunk: best, index: bestIndex, score: bestScore };
}
