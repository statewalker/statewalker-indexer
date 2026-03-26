import type { BlockId, SearchResult } from "@repo/indexer-api";

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export function bruteForceSearch(
  query: Float32Array,
  embeddings: Iterable<[BlockId, Float32Array]>,
  topK: number,
): SearchResult[] {
  const scored: SearchResult[] = [];
  for (const [blockId, embedding] of embeddings) {
    const score = cosineSimilarity(query, embedding);
    scored.push({ blockId, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
