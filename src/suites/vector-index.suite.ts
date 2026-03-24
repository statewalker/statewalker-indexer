import type { Indexer } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  loadBlocksFixture,
  loadQueriesEmbeddingsFixture,
  loadQueriesFixture,
} from "../fixtures/index.js";
import { defined } from "./test-utils.js";

export function runVectorIndexSuite(getIndexer: () => Indexer): void {
  describe("VectorIndex", () => {
    it("getIndexInfo returns configured dimensionality and model", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      const vec = defined(index.getVectorIndex());
      const info = await vec.getIndexInfo();
      expect(info.dimensionality).toBe(EMBEDDING_DIMENSIONS);
      expect(info.model).toBe(EMBEDDING_MODEL);
    });

    it("addDocument + search finds nearest vector", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: { dimensionality: 3, model: "test" },
      });
      const vec = defined(index.getVectorIndex());
      await vec.addDocument({
        blockId: "1",
        embedding: new Float32Array([1, 0, 0]),
      });
      await vec.addDocument({
        blockId: "2",
        embedding: new Float32Array([0, 1, 0]),
      });
      await vec.addDocument({
        blockId: "3",
        embedding: new Float32Array([0, 0, 1]),
      });

      const results = await vec.search({
        topK: 2,
        embedding: new Float32Array([0.9, 0.1, 0]),
      });
      expect(results[0]?.blockId).toBe("1");
    });

    it("addDocument throws on wrong dimensionality", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      const vec = defined(index.getVectorIndex());
      await expect(
        vec.addDocument({ blockId: "1", embedding: new Float32Array(128) }),
      ).rejects.toThrow();
    });

    it("deleteDocument removes from search", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: { dimensionality: 3, model: "test" },
      });
      const vec = defined(index.getVectorIndex());
      await vec.addDocument({
        blockId: "1",
        embedding: new Float32Array([1, 0, 0]),
      });
      await vec.deleteDocument("1");
      expect(await vec.hasDocument("1")).toBe(false);
      const results = await vec.search({
        topK: 10,
        embedding: new Float32Array([1, 0, 0]),
      });
      expect(results).toHaveLength(0);
    });

    it("hasDocument returns correct value", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: { dimensionality: 3, model: "test" },
      });
      const vec = defined(index.getVectorIndex());
      expect(await vec.hasDocument("1")).toBe(false);
      await vec.addDocument({
        blockId: "1",
        embedding: new Float32Array([1, 0, 0]),
      });
      expect(await vec.hasDocument("1")).toBe(true);
    });

    it("getSize returns correct count", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: { dimensionality: 3, model: "test" },
      });
      const vec = defined(index.getVectorIndex());
      expect(await vec.getSize()).toBe(0);
      await vec.addDocument({
        blockId: "1",
        embedding: new Float32Array([1, 0, 0]),
      });
      await vec.addDocument({
        blockId: "2",
        embedding: new Float32Array([0, 1, 0]),
      });
      expect(await vec.getSize()).toBe(2);
    });

    it("search ranking with all fixture queries", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      const vec = defined(index.getVectorIndex());
      const blocks = loadBlocksFixture();
      const queryEmbeddings = loadQueriesEmbeddingsFixture();
      const queries = loadQueriesFixture();

      const blockIdToFile = new Map<string, string>();
      let blockNum = 1;
      for (const [fileName, docBlocks] of Object.entries(blocks)) {
        for (const [, block] of Object.entries(docBlocks)) {
          const blockId = String(blockNum);
          await vec.addDocument({
            blockId,
            embedding: new Float32Array(block.embedding),
          });
          blockIdToFile.set(blockId, fileName);
          blockNum++;
        }
      }

      for (const q of queries) {
        const emb = defined(
          queryEmbeddings[q.id],
          `missing embedding for query "${q.id}"`,
        );
        const results = await vec.search({
          topK: 5,
          embedding: new Float32Array(emb),
        });
        expect(
          results.length,
          `query "${q.id}" returned no results`,
        ).toBeGreaterThan(0);
        const topFiles = results.map((r) => blockIdToFile.get(r.blockId));
        expect(
          topFiles,
          `query "${q.id}" expected "${q.expectedTopPath}" in top 5, got: ${topFiles.join(", ")}`,
        ).toContain(q.expectedTopPath);
      }
    });
  });
}
