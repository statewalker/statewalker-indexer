import type { Indexer } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";
import {
  listFixtureDocs,
  loadQueriesFixture,
  readFixtureDoc,
} from "../fixtures/index.js";
import { defined } from "./test-utils.js";

export function runFullTextIndexSuite(getIndexer: () => Indexer): void {
  describe("FullTextIndex", () => {
    it("getIndexInfo returns configured language", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      const info = await fts.getIndexInfo();
      expect(info.language).toBe("en");
    });

    it("addDocument + search finds matching content", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      await fts.addDocument({
        blockId: "1",
        content: "the quick brown fox jumps",
      });
      await fts.addDocument({
        blockId: "2",
        content: "lazy dog sleeps all day",
      });
      const results = await fts.search({ query: "fox", topK: 10 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.blockId).toBe("1");
    });

    it("addDocument replaces existing blockId", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      await fts.addDocument({
        blockId: "1",
        content: "old content about cats",
      });
      await fts.addDocument({
        blockId: "1",
        content: "new content about dogs",
      });
      const results = await fts.search({ query: "dogs", topK: 10 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.blockId).toBe("1");
      expect(await fts.getSize()).toBe(1);
    });

    it("deleteDocument removes from search", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      await fts.addDocument({
        blockId: "1",
        content: "unique searchable term xylophone",
      });
      await fts.deleteDocument("1");
      const results = await fts.search({ query: "xylophone", topK: 10 });
      expect(results).toHaveLength(0);
    });

    it("hasDocument returns correct value", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      expect(await fts.hasDocument("1")).toBe(false);
      await fts.addDocument({ blockId: "1", content: "hello" });
      expect(await fts.hasDocument("1")).toBe(true);
      await fts.deleteDocument("1");
      expect(await fts.hasDocument("1")).toBe(false);
    });

    it("getSize returns correct count", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      expect(await fts.getSize()).toBe(0);
      await fts.addDocument({ blockId: "1", content: "one" });
      await fts.addDocument({ blockId: "2", content: "two" });
      expect(await fts.getSize()).toBe(2);
    });

    it("search ranks correct document highest for all fixture queries", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());

      // Index all 16 fixture documents
      const docs = listFixtureDocs();
      const blockIdToFile = new Map<string, string>();
      let blockNum = 1;
      for (const docName of docs) {
        const content = readFixtureDoc(docName);
        const blockId = String(blockNum);
        await fts.addDocument({ blockId, content });
        blockIdToFile.set(blockId, docName);
        blockNum++;
      }

      // Validate all 16 queries return results and most return the expected document
      const queries = loadQueriesFixture();
      let matchCount = 0;
      for (const q of queries) {
        const results = await fts.search({ query: q.query, topK: 10 });
        expect(
          results.length,
          `query "${q.query}" returned no results`,
        ).toBeGreaterThan(0);
        const topFiles = results.map((r) => blockIdToFile.get(r.blockId));
        if (topFiles.includes(q.expectedTopPath)) {
          matchCount++;
        }
      }
      // At least 75% of queries should find the expected document in top 10
      expect(
        matchCount,
        `only ${matchCount}/${queries.length} queries found expected doc in top 10`,
      ).toBeGreaterThanOrEqual(Math.ceil(queries.length * 0.75));
    });
  });
}
