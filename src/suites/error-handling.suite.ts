import type { Indexer } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../fixtures/index.js";
import { defined } from "./test-utils.js";

export function runErrorHandlingSuite(getIndexer: () => Indexer): void {
  describe("Error Handling", () => {
    it("throws on wrong embedding dimensionality", async () => {
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
        vec.addDocument([
          {
            path: "/test/1",
            blockId: "1",
            embedding: new Float32Array(EMBEDDING_DIMENSIONS + 10),
          },
        ]),
      ).rejects.toThrow();
    });

    it("throws when neither fulltext nor vector provided", async () => {
      const indexer = getIndexer();
      await expect(indexer.createIndex({ name: "empty" })).rejects.toThrow();
    });

    it("throws on duplicate index name without overwrite", async () => {
      const indexer = getIndexer();
      await indexer.createIndex({ name: "dup", fulltext: { language: "en" } });
      await expect(
        indexer.createIndex({ name: "dup", fulltext: { language: "en" } }),
      ).rejects.toThrow();
    });

    it("overwrite: true replaces existing index", async () => {
      const indexer = getIndexer();
      await indexer.createIndex({ name: "dup", fulltext: { language: "en" } });
      const replaced = await indexer.createIndex({
        name: "dup",
        fulltext: { language: "en" },
        overwrite: true,
      });
      expect(await replaced.getSize()).toBe(0);
    });
  });
}
