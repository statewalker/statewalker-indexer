import type { Indexer } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  loadBlocksFixture,
  loadQueriesEmbeddingsFixture,
  loadQueriesFixture,
} from "../fixtures/index.js";
import { collect } from "./test-utils.js";

export function runSearchQualitySuite(getIndexer: () => Indexer): void {
  describe("Search Quality", () => {
    async function indexFixtureBlocks(indexer: Indexer) {
      const blocks = loadBlocksFixture();
      const index = await indexer.createIndex({
        name: "quality",
        fulltext: { language: "en" },
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });

      const blockIdToFile = new Map<string, string>();
      let blockNum = 1;
      for (const [fileName, docBlocks] of Object.entries(blocks)) {
        for (const [, block] of Object.entries(docBlocks)) {
          const blockId = String(blockNum);
          await index.addDocument([
            {
              path: `/${fileName}` as `/${string}`,
              blockId,
              content: block.text,
              embedding: new Float32Array(block.embedding),
            },
          ]);
          blockIdToFile.set(blockId, fileName);
          blockNum++;
        }
      }

      return { index, blockIdToFile };
    }

    it("FTS Hit@1 >= 40% and Hit@3 >= 60%", async () => {
      const indexer = getIndexer();
      const { index, blockIdToFile } = await indexFixtureBlocks(indexer);
      const queries = loadQueriesFixture();

      let hit1 = 0;
      let hit3 = 0;
      for (const q of queries) {
        const results = await collect(
          index.search({
            queries: [q.query],
            topK: 10,
            weights: { fts: 1, embedding: 0 },
          }),
        );
        const topFiles = results.map((r) => blockIdToFile.get(r.blockId));
        if (topFiles[0] === q.expectedTopPath) hit1++;
        if (topFiles.slice(0, 3).includes(q.expectedTopPath)) hit3++;
      }

      const rate1 = hit1 / queries.length;
      const rate3 = hit3 / queries.length;
      expect(
        rate1,
        `FTS Hit@1 = ${(rate1 * 100).toFixed(0)}%`,
      ).toBeGreaterThanOrEqual(0.4);
      expect(
        rate3,
        `FTS Hit@3 = ${(rate3 * 100).toFixed(0)}%`,
      ).toBeGreaterThanOrEqual(0.6);
    });

    it("Vector Hit@1 >= 30% and Hit@3 >= 50%", async () => {
      const indexer = getIndexer();
      const { index, blockIdToFile } = await indexFixtureBlocks(indexer);
      const queries = loadQueriesFixture();
      const queryEmbeddings = loadQueriesEmbeddingsFixture();

      let hit1 = 0;
      let hit3 = 0;
      for (const q of queries) {
        const emb = queryEmbeddings[q.id];
        if (!emb) continue;
        const results = await collect(
          index.search({
            embeddings: [new Float32Array(emb)],
            topK: 10,
            weights: { fts: 0, embedding: 1 },
          }),
        );
        const topFiles = results.map((r) => blockIdToFile.get(r.blockId));
        if (topFiles[0] === q.expectedTopPath) hit1++;
        if (topFiles.slice(0, 3).includes(q.expectedTopPath)) hit3++;
      }

      const rate1 = hit1 / queries.length;
      const rate3 = hit3 / queries.length;
      expect(
        rate1,
        `Vec Hit@1 = ${(rate1 * 100).toFixed(0)}%`,
      ).toBeGreaterThanOrEqual(0.3);
      expect(
        rate3,
        `Vec Hit@3 = ${(rate3 * 100).toFixed(0)}%`,
      ).toBeGreaterThanOrEqual(0.5);
    });

    it("Hybrid Hit@3 >= max(FTS, Vector) Hit@3", async () => {
      const indexer = getIndexer();
      const { index, blockIdToFile } = await indexFixtureBlocks(indexer);
      const queries = loadQueriesFixture();
      const queryEmbeddings = loadQueriesEmbeddingsFixture();

      let ftsHit3 = 0;
      let vecHit3 = 0;
      let hybridHit3 = 0;

      for (const q of queries) {
        const emb = queryEmbeddings[q.id];
        if (!emb) continue;

        // FTS only
        const ftsResults = await collect(
          index.search({
            queries: [q.query],
            topK: 10,
            weights: { fts: 1, embedding: 0 },
          }),
        );
        if (
          ftsResults
            .slice(0, 3)
            .some((r) => blockIdToFile.get(r.blockId) === q.expectedTopPath)
        )
          ftsHit3++;

        // Vector only
        const vecResults = await collect(
          index.search({
            embeddings: [new Float32Array(emb)],
            topK: 10,
            weights: { fts: 0, embedding: 1 },
          }),
        );
        if (
          vecResults
            .slice(0, 3)
            .some((r) => blockIdToFile.get(r.blockId) === q.expectedTopPath)
        )
          vecHit3++;

        // Hybrid
        const hybridResults = await collect(
          index.search({
            queries: [q.query],
            embeddings: [new Float32Array(emb)],
            topK: 10,
          }),
        );
        if (
          hybridResults
            .slice(0, 3)
            .some((r) => blockIdToFile.get(r.blockId) === q.expectedTopPath)
        )
          hybridHit3++;
      }

      const best = Math.max(ftsHit3, vecHit3);
      expect(
        hybridHit3,
        `Hybrid Hit@3 (${hybridHit3}) should >= max(FTS=${ftsHit3}, Vec=${vecHit3})`,
      ).toBeGreaterThanOrEqual(best);
    });
  });
}
