import type { Indexer } from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";
import { collect, defined } from "./test-utils.js";

export function runLifecycleSuite(getIndexer: () => Indexer): void {
  describe("Lifecycle", () => {
    it("close on indexer closes all indexes", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([{ path: "/test/1", blockId: "1", content: "hello" }]);
      await indexer.close();
      // Subsequent operations should throw
      await expect(
        indexer.createIndex({ name: "new", fulltext: { language: "en" } }),
      ).rejects.toThrow();
    });

    it("close is idempotent", async () => {
      const indexer = getIndexer();
      await indexer.close();
      await expect(indexer.close()).resolves.toBeUndefined();
    });

    it("operations after Index.close() throw", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.close();
      await expect(
        index.addDocument([{ path: "/test/1", blockId: "1", content: "hello" }]),
      ).rejects.toThrow();
    });

    it("operations after FullTextIndex.close() throw", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      await fts.close();
      await expect(
        fts.addDocument([{ path: "/test/1", blockId: "1", content: "hello" }]),
      ).rejects.toThrow();
    });

    it("operations after EmbeddingIndex.close() throw", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: { dimensionality: 3, model: "test" },
      });
      const vec = defined(index.getVectorIndex());
      await vec.close();
      await expect(
        vec.addDocument([
          {
            path: "/test/1",
            blockId: "1",
            embedding: new Float32Array([1, 0, 0]),
          },
        ]),
      ).rejects.toThrow();
    });

    it("flush does not close the index", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([{ path: "/test/1", blockId: "1", content: "hello" }]);
      await index.flush();
      // Index should still be usable
      const results = await collect(index.search({ queries: ["hello"], topK: 10 }));
      expect(results.length).toBeGreaterThan(0);
    });
  });
}
