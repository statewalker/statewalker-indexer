import type { Indexer } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";
import { defined } from "./test-utils.js";

export function runLifecycleSuite(getIndexer: () => Indexer): void {
  describe("Lifecycle", () => {
    it("close() on Indexer closes all open indexes", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await indexer.close();
      await expect(
        index.addDocument({ blockId: "1", content: "hello" }),
      ).rejects.toThrow();
    });

    it("close() on Index is idempotent", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.close();
      await expect(index.close()).resolves.toBeUndefined();
    });

    it("operations after close() throw on Indexer", async () => {
      const indexer = getIndexer();
      await indexer.close();
      await expect(indexer.getIndexNames()).rejects.toThrow();
      await expect(indexer.hasIndex("test")).rejects.toThrow();
      await expect(indexer.deleteIndex("test")).rejects.toThrow();
    });

    it("operations after close() throw on Index", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.close();
      await expect(index.search({ query: "test", topK: 5 })).rejects.toThrow();
      await expect(
        index.addDocument({ blockId: "1", content: "hello" }),
      ).rejects.toThrow();
      await expect(index.hasDocument("1")).rejects.toThrow();
      await expect(index.getSize()).rejects.toThrow();
    });

    it("operations after close() throw on FullTextIndex", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      await index.close();
      await expect(fts.search({ query: "test", topK: 5 })).rejects.toThrow();
      await expect(
        fts.addDocument({ blockId: "1", content: "hello" }),
      ).rejects.toThrow();
    });

    it("operations after close() throw on VectorIndex", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: { dimensionality: 3, model: "test" },
      });
      const vec = defined(index.getVectorIndex());
      await index.close();
      await expect(
        vec.search({ topK: 5, embedding: new Float32Array([1, 0, 0]) }),
      ).rejects.toThrow();
      await expect(
        vec.addDocument({
          blockId: "1",
          embedding: new Float32Array([1, 0, 0]),
        }),
      ).rejects.toThrow();
    });
  });
}
