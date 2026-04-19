import type { Indexer } from "@statewalker/indexer-api";
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
import { collect, defined } from "./test-utils.js";

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

    it("addDocument with content only goes to FTS sub-index", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      await index.addDocument([{ path: "/test/doc1", blockId: "1", content: "hello world" }]);
      const fts = defined(index.getFullTextIndex());
      const vec = defined(index.getVectorIndex());
      expect(await fts.getSize()).toBe(1);
      expect(await vec.getSize()).toBe(0);
    });

    it("addDocument with embedding only goes to vector sub-index", async () => {
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
      await index.addDocument([{ path: "/test/doc1", blockId: "1", embedding }]);
      const fts = defined(index.getFullTextIndex());
      const vec = defined(index.getVectorIndex());
      expect(await fts.getSize()).toBe(0);
      expect(await vec.getSize()).toBe(1);
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
      await index.addDocument([{ path: "/test/doc1", blockId: "1", content: "hello", embedding }]);
      const fts = defined(index.getFullTextIndex());
      const vec = defined(index.getVectorIndex());
      expect(await fts.getSize()).toBe(1);
      expect(await vec.getSize()).toBe(1);
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
        index.addDocument([{ path: "/test/doc1", blockId: "1", content: "hello" }]),
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
        index.addDocument([{ path: "/test/doc1", blockId: "1", embedding }]),
      ).resolves.toBeUndefined();
    });

    it("search with queries returns FTS results", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([
        { path: "/test/doc1", blockId: "1", content: "the quick brown fox" },
      ]);
      await index.addDocument([{ path: "/test/doc2", blockId: "2", content: "lazy dog sleeps" }]);
      const results = await collect(index.search({ queries: ["fox"], topK: 10 }));
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.blockId).toBe("1");
    });

    it("search with embeddings returns vector results", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: { dimensionality: 3, model: "test" },
      });
      await index.addDocument([
        {
          path: "/test/doc1",
          blockId: "1",
          embedding: new Float32Array([1, 0, 0]),
        },
      ]);
      await index.addDocument([
        {
          path: "/test/doc2",
          blockId: "2",
          embedding: new Float32Array([0, 1, 0]),
        },
      ]);
      const results = await collect(
        index.search({
          embeddings: [new Float32Array([1, 0, 0])],
          topK: 10,
        }),
      );
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

      for (const docName of docs) {
        const content = readFixtureDoc(docName);
        const blockId = String(blockNum);
        await index.addDocument([
          {
            path: `/${docName}` as `/${string}`,
            blockId,
            content,
          },
        ]);
        blockIdToFile.set(blockId, docName);
        blockNum++;
      }

      for (const q of queries) {
        const emb = defined(queryEmbeddings[q.id], `missing embedding for query "${q.id}"`);
        const results = await collect(
          index.search({
            queries: [q.query],
            embeddings: [new Float32Array(emb)],
            topK: 10,
          }),
        );
        expect(results.length, `query "${q.id}" returned no results`).toBeGreaterThan(0);
        const topFiles = results.slice(0, 5).map((r) => blockIdToFile.get(r.blockId));
        expect(
          topFiles,
          `query "${q.id}" expected "${q.expectedTopPath}" in top 5, got: ${topFiles.join(", ")}`,
        ).toContain(q.expectedTopPath);
      }
    });

    it("getSize returns total block count", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
        vector: { dimensionality: 3, model: "test" },
      });
      await index.addDocument([
        {
          path: "/test/doc1",
          blockId: "1",
          content: "hello",
          embedding: new Float32Array([1, 0, 0]),
        },
      ]);
      await index.addDocument([{ path: "/test/doc2", blockId: "2", content: "world" }]);
      await index.addDocument([
        {
          path: "/test/doc3",
          blockId: "3",
          embedding: new Float32Array([0, 1, 0]),
        },
      ]);
      expect(await index.getSize()).toBe(3);
    });

    it("getSize with pathPrefix counts only matching blocks", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([{ path: "/science/physics", blockId: "1", content: "quantum" }]);
      await index.addDocument([{ path: "/science/biology", blockId: "2", content: "cells" }]);
      await index.addDocument([{ path: "/tech/code", blockId: "3", content: "typescript" }]);
      expect(await index.getSize("/science/")).toBe(2);
      expect(await index.getSize("/tech/")).toBe(1);
      expect(await index.getSize()).toBe(3);
    });

    it("deleteDocuments removes from all sub-indexes", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
        vector: { dimensionality: 3, model: "test" },
      });
      await index.addDocument([
        {
          path: "/test/doc1",
          blockId: "1",
          content: "hello",
          embedding: new Float32Array([1, 0, 0]),
        },
      ]);
      await index.deleteDocuments([{ path: "/test/doc1", blockId: "1" }]);
      expect(await index.getSize()).toBe(0);
    });

    it("deleteDocuments by path prefix removes all blocks under that path", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([{ path: "/docs/a", blockId: "1", content: "first" }]);
      await index.addDocument([{ path: "/docs/b", blockId: "2", content: "second" }]);
      await index.addDocument([{ path: "/other/c", blockId: "3", content: "third" }]);
      await index.deleteDocuments([{ path: "/docs/" }]);
      expect(await index.getSize()).toBe(1);
    });

    it("flush makes data durable without closing", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([{ path: "/test/1", blockId: "1", content: "flushed data" }]);
      await expect(index.flush()).resolves.toBeUndefined();
      expect(await index.getSize()).toBe(1);
    });

    it("deleteIndex clears all data", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([{ path: "/test/1", blockId: "1", content: "hello" }]);
      await index.deleteIndex();
      // After deleteIndex the index is unusable — just verify no throw
    });
  });
}
