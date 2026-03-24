import type { Indexer } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  listFixtureDocs,
  loadBlocksFixture,
  loadQueriesEmbeddingsFixture,
  loadQueriesFixture,
  readFixtureDoc,
} from "../fixtures/index.js";
import { defined } from "./test-utils.js";

export function runIndexSuite(getIndexer: () => Indexer): void {
  describe("Index", () => {
    it("name and metadata reflect creation params", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en", metadata: { foo: "bar" } },
      });
      expect(index.name).toBe("test");
    });

    it("getFullTextIndex/getVectorIndex returns sub-index or null", async () => {
      const indexer = getIndexer();
      const ftsOnly = await indexer.createIndex({
        name: "fts",
        fulltext: { language: "en" },
      });
      expect(ftsOnly.getFullTextIndex()).not.toBeNull();
      expect(ftsOnly.getVectorIndex()).toBeNull();

      const vecOnly = await indexer.createIndex({
        name: "vec",
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      expect(vecOnly.getFullTextIndex()).toBeNull();
      expect(vecOnly.getVectorIndex()).not.toBeNull();
    });

    it("addDocument with content only goes to FTS", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      await index.addDocument({ blockId: "1", content: "hello world" });
      expect(await index.getFullTextIndex()?.hasDocument("1")).toBe(true);
      expect(await index.getVectorIndex()?.hasDocument("1")).toBe(false);
    });

    it("addDocument with embedding only goes to vector", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      const embedding = new Float32Array(EMBEDDING_DIMENSIONS);
      embedding[0] = 1.0;
      await index.addDocument({ blockId: "1", embedding });
      expect(await index.getFullTextIndex()?.hasDocument("1")).toBe(false);
      expect(await index.getVectorIndex()?.hasDocument("1")).toBe(true);
    });

    it("addDocument with both goes to both sub-indexes", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      const embedding = new Float32Array(EMBEDDING_DIMENSIONS);
      embedding[0] = 1.0;
      await index.addDocument({ blockId: "1", content: "hello", embedding });
      expect(await index.getFullTextIndex()?.hasDocument("1")).toBe(true);
      expect(await index.getVectorIndex()?.hasDocument("1")).toBe(true);
    });

    it("addDocument silently ignores content when no FTS sub-index", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      await expect(
        index.addDocument({ blockId: "1", content: "hello" }),
      ).resolves.toBeUndefined();
    });

    it("addDocument silently ignores embedding when no vector sub-index", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const embedding = new Float32Array(EMBEDDING_DIMENSIONS);
      await expect(
        index.addDocument({ blockId: "1", embedding }),
      ).resolves.toBeUndefined();
    });

    it("search with query only returns FTS results", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument({ blockId: "1", content: "the quick brown fox" });
      await index.addDocument({ blockId: "2", content: "lazy dog sleeps" });
      const results = await index.search({ query: "fox", topK: 10 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.blockId).toBe("1");
    });

    it("search with embedding only returns vector results", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: { dimensionality: 3, model: "test" },
      });
      await index.addDocument({
        blockId: "1",
        embedding: new Float32Array([1, 0, 0]),
      });
      await index.addDocument({
        blockId: "2",
        embedding: new Float32Array([0, 1, 0]),
      });
      const results = await index.search({
        embedding: new Float32Array([1, 0, 0]),
        topK: 10,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.blockId).toBe("1");
    });

    it("hybrid search returns correct document for all fixture queries", async () => {
      const indexer = getIndexer();
      const blocks = loadBlocksFixture();
      const queryEmbeddings = loadQueriesEmbeddingsFixture();
      const queries = loadQueriesFixture();
      const docs = listFixtureDocs();

      const index = await indexer.createIndex({
        name: "hybrid",
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
          await index.addDocument({
            blockId,
            content: block.text,
            embedding: new Float32Array(block.embedding),
          });
          blockIdToFile.set(blockId, fileName);
          blockNum++;
        }
      }

      for (const docName of docs) {
        const content = readFixtureDoc(docName);
        const blockId = String(blockNum);
        await index.addDocument({ blockId, content });
        blockIdToFile.set(blockId, docName);
        blockNum++;
      }

      for (const q of queries) {
        const emb = defined(
          queryEmbeddings[q.id],
          `missing embedding for query "${q.id}"`,
        );
        const results = await index.search({
          query: q.query,
          embedding: new Float32Array(emb),
          topK: 10,
        });
        expect(
          results.length,
          `query "${q.id}" returned no results`,
        ).toBeGreaterThan(0);
        const topFiles = results
          .slice(0, 5)
          .map((r) => blockIdToFile.get(r.blockId));
        expect(
          topFiles,
          `query "${q.id}" expected "${q.expectedTopPath}" in top 5, got: ${topFiles.join(", ")}`,
        ).toContain(q.expectedTopPath);
      }
    });

    it("hasDocument returns true if in any sub-index", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
        vector: { dimensionality: 3, model: "test" },
      });
      await index.addDocument({ blockId: "1", content: "hello" });
      await index.addDocument({
        blockId: "2",
        embedding: new Float32Array([1, 0, 0]),
      });
      expect(await index.hasDocument("1")).toBe(true);
      expect(await index.hasDocument("2")).toBe(true);
      expect(await index.hasDocument("3")).toBe(false);
    });

    it("getSize returns union count", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
        vector: { dimensionality: 3, model: "test" },
      });
      await index.addDocument({
        blockId: "1",
        content: "hello",
        embedding: new Float32Array([1, 0, 0]),
      });
      await index.addDocument({ blockId: "2", content: "world" });
      await index.addDocument({
        blockId: "3",
        embedding: new Float32Array([0, 1, 0]),
      });
      expect(await index.getSize()).toBe(3);
    });

    it("deleteDocument removes from all sub-indexes", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
        vector: { dimensionality: 3, model: "test" },
      });
      await index.addDocument({
        blockId: "1",
        content: "hello",
        embedding: new Float32Array([1, 0, 0]),
      });
      await index.deleteDocument("1");
      expect(await index.hasDocument("1")).toBe(false);
      expect(await index.getSize()).toBe(0);
    });
  });
}
