import type { EmbedFn } from "@statewalker/indexer-api";
import {
  EMBEDDING_DIMENSIONS,
  loadBlocksFixture,
  loadQueriesEmbeddingsFixture,
  loadQueriesFixture,
} from "./fixture-loader.js";

/**
 * Creates an EmbedFn that returns pre-computed embeddings from fixtures.
 * Looks up embeddings by matching text against:
 * 1. Block fixture data (block text → block embedding)
 * 2. Query fixture data (query text → query embedding)
 * Falls back to zero vectors for texts not found in fixtures.
 */
export function createFixtureEmbedFn(): EmbedFn {
  const blocksFixture = loadBlocksFixture();
  const queriesEmbeddings = loadQueriesEmbeddingsFixture();
  const queries = loadQueriesFixture();

  const textToEmbedding = new Map<string, number[]>();

  // Map block text → embedding
  for (const docBlocks of Object.values(blocksFixture)) {
    for (const block of Object.values(docBlocks)) {
      textToEmbedding.set(block.text, block.embedding);
    }
  }

  // Map query text → query embedding
  for (const q of queries) {
    const emb = queriesEmbeddings[q.id];
    if (emb) {
      textToEmbedding.set(q.query, emb);
    }
  }

  return async (text: string): Promise<Float32Array> => {
    const embedding = textToEmbedding.get(text);
    if (embedding) return new Float32Array(embedding);
    return new Float32Array(EMBEDDING_DIMENSIONS);
  };
}
