import type { Indexer } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../fixtures/index.js";
import { defined } from "./test-utils.js";

export function runErrorHandlingSuite(getIndexer: () => Indexer): void {
  describe("Error Handling", () => {
    it("wrong embedding dimensionality throws on VectorIndex", async () => {
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

    it("wrong embedding dimensionality throws via Index", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      await expect(
        index.addDocument({ blockId: "1", embedding: new Float32Array(128) }),
      ).rejects.toThrow();
    });

    it("createIndex without fulltext or vector throws", async () => {
      const indexer = getIndexer();
      await expect(indexer.createIndex({ name: "empty" })).rejects.toThrow();
    });

    it("createIndex with existing name and overwrite: false throws", async () => {
      const indexer = getIndexer();
      await indexer.createIndex({ name: "test", fulltext: { language: "en" } });
      await expect(
        indexer.createIndex({
          name: "test",
          fulltext: { language: "en" },
          overwrite: false,
        }),
      ).rejects.toThrow();
    });
  });
}
