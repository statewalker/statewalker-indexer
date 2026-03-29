import type { DocumentPath, EmbeddingSearchResult } from "@repo/indexer-api";

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
  entries: Iterable<{
    path: DocumentPath;
    blockId: string;
    embedding: Float32Array;
  }>,
  topK: number,
): EmbeddingSearchResult[] {
  const scored: EmbeddingSearchResult[] = [];
  for (const entry of entries) {
    const score = cosineSimilarity(query, entry.embedding);
    scored.push({ path: entry.path, blockId: entry.blockId, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
