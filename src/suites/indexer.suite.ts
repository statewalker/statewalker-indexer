import type { Indexer } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../fixtures/index.js";

export function runIndexerSuite(getIndexer: () => Indexer): void {
  describe("Indexer", () => {
    it("creates index with fulltext only", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "fts-only",
        fulltext: { language: "en" },
      });
      expect(index.name).toBe("fts-only");
      expect(index.getFullTextIndex()).not.toBeNull();
      expect(index.getVectorIndex()).toBeNull();
    });

    it("creates index with vector only", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "vec-only",
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      expect(index.name).toBe("vec-only");
      expect(index.getFullTextIndex()).toBeNull();
      expect(index.getVectorIndex()).not.toBeNull();
    });

    it("creates index with both fulltext and vector", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "hybrid",
        fulltext: { language: "en" },
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      expect(index.getFullTextIndex()).not.toBeNull();
      expect(index.getVectorIndex()).not.toBeNull();
    });

    it("throws when creating index with existing name and overwrite: false", async () => {
      const indexer = getIndexer();
      await indexer.createIndex({ name: "test", fulltext: { language: "en" } });
      await expect(
        indexer.createIndex({ name: "test", fulltext: { language: "en" } }),
      ).rejects.toThrow();
    });

    it("replaces index when overwrite: true", async () => {
      const indexer = getIndexer();
      const first = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await first.addDocument({ blockId: "1", content: "hello" });
      const second = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
        overwrite: true,
      });
      expect(await second.getSize()).toBe(0);
    });

    it("throws when neither fulltext nor vector provided", async () => {
      const indexer = getIndexer();
      await expect(indexer.createIndex({ name: "empty" })).rejects.toThrow();
    });

    it("getIndex returns cached instance", async () => {
      const indexer = getIndexer();
      await indexer.createIndex({
        name: "cached",
        fulltext: { language: "en" },
      });
      const a = await indexer.getIndex("cached");
      const b = await indexer.getIndex("cached");
      expect(a).toBe(b);
    });

    it("getIndex returns null for non-existent", async () => {
      const indexer = getIndexer();
      expect(await indexer.getIndex("nope")).toBeNull();
    });

    it("hasIndex returns true/false correctly", async () => {
      const indexer = getIndexer();
      expect(await indexer.hasIndex("test")).toBe(false);
      await indexer.createIndex({ name: "test", fulltext: { language: "en" } });
      expect(await indexer.hasIndex("test")).toBe(true);
    });

    it("deleteIndex removes index", async () => {
      const indexer = getIndexer();
      await indexer.createIndex({ name: "test", fulltext: { language: "en" } });
      await indexer.deleteIndex("test");
      expect(await indexer.getIndex("test")).toBeNull();
      expect(await indexer.hasIndex("test")).toBe(false);
    });

    it("deleteIndex does nothing for non-existent", async () => {
      const indexer = getIndexer();
      await expect(indexer.deleteIndex("nope")).resolves.toBeUndefined();
    });

    it("getIndexNames lists all indexes", async () => {
      const indexer = getIndexer();
      await indexer.createIndex({
        name: "alpha",
        fulltext: { language: "en", metadata: { type: "fts" } },
      });
      await indexer.createIndex({
        name: "beta",
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      const names = await indexer.getIndexNames();
      expect(names).toHaveLength(2);
      const sorted = names.sort((a, b) => a.name.localeCompare(b.name));
      expect(sorted[0]?.name).toBe("alpha");
      expect(sorted[1]?.name).toBe("beta");
    });

    it("close makes subsequent operations throw", async () => {
      const indexer = getIndexer();
      await indexer.close();
      await expect(
        indexer.createIndex({ name: "test", fulltext: { language: "en" } }),
      ).rejects.toThrow();
    });
  });
}
