import type { Indexer } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";
import {
  createFixtureEmbedFn,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  loadBlocksFixture,
  loadQueriesEmbeddingsFixture,
  loadQueriesFixture,
} from "../fixtures/index.js";

/**
 * Compute Hit@K: fraction of queries where the expected doc appears in top K results.
 */
function hitAtK(
  results: Map<string, string[]>,
  queries: Array<{ id: string; expectedTopPath: string }>,
  k: number,
): number {
  let hits = 0;
  for (const q of queries) {
    const topK = results.get(q.id)?.slice(0, k) ?? [];
    if (topK.some((blockId) => blockId.startsWith(q.expectedTopPath))) {
      hits++;
    }
  }
  return queries.length > 0 ? hits / queries.length : 0;
}

export function runSearchQualitySuite(getIndexer: () => Indexer): void {
  describe("Search Quality Evaluation", () => {
    let ftsResults: Map<string, string[]>;
    let vectorResults: Map<string, string[]>;
    let hybridResults: Map<string, string[]>;
    let queries: Array<{ id: string; expectedTopPath: string; expectedTopics: string[] }>;
    let indexed = false;

    async function ensureIndexed(indexer: Indexer): Promise<void> {
      if (indexed) return;

      const blocks = loadBlocksFixture();
      queries = loadQueriesFixture();
      const queriesEmbeddings = loadQueriesEmbeddingsFixture();

      const index = await indexer.createIndex({
        name: "eval",
        fulltext: { language: "en" },
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });

      // Add all blocks from all fixture docs
      for (const [docPath, docBlocks] of Object.entries(blocks)) {
        for (const [blockKey, block] of Object.entries(docBlocks)) {
          const blockId = `${docPath}/block-${blockKey}`;
          await index.addDocument({
            blockId,
            content: block.text,
            embedding: new Float32Array(block.embedding),
          });
        }
      }

      // Run all queries across FTS, vector, and hybrid
      ftsResults = new Map();
      vectorResults = new Map();
      hybridResults = new Map();

      for (const q of queries) {
        const queryEmbedding = queriesEmbeddings[q.id];
        const embeddingArray = queryEmbedding
          ? new Float32Array(queryEmbedding)
          : undefined;

        // FTS only
        const ftsHits = await index.search({
          query: q.query,
          topK: 10,
          weights: { fts: 1, embedding: 0 },
        });
        ftsResults.set(
          q.id,
          ftsHits.map((r) => r.blockId),
        );

        // Vector only
        if (embeddingArray) {
          const vecHits = await index.search({
            embedding: embeddingArray,
            topK: 10,
            weights: { fts: 0, embedding: 1 },
          });
          vectorResults.set(
            q.id,
            vecHits.map((r) => r.blockId),
          );
        }

        // Hybrid
        const hybridHits = await index.search({
          query: q.query,
          embedding: embeddingArray,
          topK: 10,
        });
        hybridResults.set(
          q.id,
          hybridHits.map((r) => r.blockId),
        );
      }

      indexed = true;
    }

    it("FTS Hit@1 >= 40%", async () => {
      await ensureIndexed(getIndexer());
      const score = hitAtK(ftsResults, queries, 1);
      expect(score).toBeGreaterThanOrEqual(0.4);
    });

    it("FTS Hit@3 >= 60%", async () => {
      await ensureIndexed(getIndexer());
      const score = hitAtK(ftsResults, queries, 3);
      expect(score).toBeGreaterThanOrEqual(0.6);
    });

    it("Vector Hit@1 >= 30%", async () => {
      await ensureIndexed(getIndexer());
      const score = hitAtK(vectorResults, queries, 1);
      expect(score).toBeGreaterThanOrEqual(0.3);
    });

    it("Vector Hit@3 >= 50%", async () => {
      await ensureIndexed(getIndexer());
      const score = hitAtK(vectorResults, queries, 3);
      expect(score).toBeGreaterThanOrEqual(0.5);
    });

    it("Hybrid Hit@3 >= max(FTS, Vector) Hit@3", async () => {
      await ensureIndexed(getIndexer());
      const ftsScore = hitAtK(ftsResults, queries, 3);
      const vecScore = hitAtK(vectorResults, queries, 3);
      const hybridScore = hitAtK(hybridResults, queries, 3);
      expect(hybridScore).toBeGreaterThanOrEqual(Math.max(ftsScore, vecScore));
    });

    it("Hybrid Hit@3 >= 50%", async () => {
      await ensureIndexed(getIndexer());
      const score = hitAtK(hybridResults, queries, 3);
      expect(score).toBeGreaterThanOrEqual(0.5);
    });
  });
}
