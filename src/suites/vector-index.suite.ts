import type { Indexer } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  loadBlocksFixture,
  loadQueriesEmbeddingsFixture,
  loadQueriesFixture,
} from "../fixtures/index.js";
import { collect, defined } from "./test-utils.js";

export function runVectorIndexSuite(getIndexer: () => Indexer): void {
  describe("EmbeddingIndex", () => {
    it("getIndexInfo returns dimensionality and model", async () => {
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

    it("nearest neighbor search returns correct result", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: { dimensionality: 3, model: "test" },
      });
      const vec = defined(index.getVectorIndex());
      await vec.addDocument([
        {
          path: "/test/1",
          blockId: "1",
          embedding: new Float32Array([1, 0, 0]),
        },
        {
          path: "/test/1",
          blockId: "2",
          embedding: new Float32Array([0, 1, 0]),
        },
      ]);
      const results = await collect(
        vec.search({
          embeddings: [new Float32Array([0.9, 0.1, 0])],
          topK: 2,
        }),
      );
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.blockId).toBe("1");
      expect(results[0]?.path).toBe("/test/1");
      expect(results[0]?.score).toBeGreaterThan(0);
    });

    it("throws on wrong dimensionality", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: { dimensionality: 3, model: "test" },
      });
      const vec = defined(index.getVectorIndex());
      await expect(
        vec.addDocument([
          {
            path: "/test/1",
            blockId: "1",
            embedding: new Float32Array([1, 0, 0, 0, 0]),
          },
        ]),
      ).rejects.toThrow();
    });

    it("deleteDocuments removes block", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: { dimensionality: 3, model: "test" },
      });
      const vec = defined(index.getVectorIndex());
      await vec.addDocument([
        {
          path: "/test/1",
          blockId: "1",
          embedding: new Float32Array([1, 0, 0]),
        },
      ]);
      await vec.deleteDocuments([{ path: "/test/1", blockId: "1" }]);
      expect(await vec.getSize()).toBe(0);
    });

    it("getSize counts blocks", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: { dimensionality: 3, model: "test" },
      });
      const vec = defined(index.getVectorIndex());
      await vec.addDocument([
        {
          path: "/test/1",
          blockId: "1",
          embedding: new Float32Array([1, 0, 0]),
        },
        {
          path: "/test/1",
          blockId: "2",
          embedding: new Float32Array([0, 1, 0]),
        },
      ]);
      expect(await vec.getSize()).toBe(2);
    });

    it("search ranks fixture queries reasonably", async () => {
      const indexer = getIndexer();
      const blocks = loadBlocksFixture();
      const queryEmbeddings = loadQueriesEmbeddingsFixture();
      const queries = loadQueriesFixture();

      const index = await indexer.createIndex({
        name: "quality",
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      const vec = defined(index.getVectorIndex());

      const blockIdToFile = new Map<string, string>();
      let blockNum = 1;
      for (const [fileName, docBlocks] of Object.entries(blocks)) {
        for (const [, block] of Object.entries(docBlocks)) {
          const blockId = String(blockNum);
          await vec.addDocument([
            {
              path: `/${fileName}` as `/${string}`,
              blockId,
              embedding: new Float32Array(block.embedding),
            },
          ]);
          blockIdToFile.set(blockId, fileName);
          blockNum++;
        }
      }

      let hits = 0;
      for (const q of queries) {
        const emb = queryEmbeddings[q.id];
        if (!emb) continue;
        const results = await collect(
          vec.search({
            embeddings: [new Float32Array(emb)],
            topK: 10,
          }),
        );
        const topFiles = results.map((r) => blockIdToFile.get(r.blockId));
        if (topFiles.includes(q.expectedTopPath)) hits++;
      }

      const hitRate = hits / queries.length;
      expect(
        hitRate,
        `Vector Hit@10 = ${(hitRate * 100).toFixed(0)}%, expected >= 50%`,
      ).toBeGreaterThanOrEqual(0.5);
    });
  });
}
