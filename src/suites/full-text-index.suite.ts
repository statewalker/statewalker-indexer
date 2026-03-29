import type { Indexer } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";
import { loadBlocksFixture, loadQueriesFixture } from "../fixtures/index.js";
import { collect, defined } from "./test-utils.js";

export function runFullTextIndexSuite(getIndexer: () => Indexer): void {
  describe("FullTextIndex", () => {
    it("getIndexInfo returns language", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      const info = await fts.getIndexInfo();
      expect(info.language).toBe("en");
    });

    it("addDocument + search returns matching block", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      await fts.addDocument([
        {
          path: "/docs/1",
          blockId: "1",
          content: "the quick brown fox jumps over the lazy dog",
        },
      ]);
      const results = await collect(fts.search({ queries: ["fox"], topK: 10 }));
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.blockId).toBe("1");
      expect(results[0]?.path).toBe("/docs/1");
      expect(results[0]?.score).toBeGreaterThan(0);
      expect(results[0]?.snippet).toBeDefined();
    });

    it("replaces content when same path+blockId is re-added", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      await fts.addDocument([
        { path: "/docs/1", blockId: "1", content: "original content" },
      ]);
      await fts.addDocument([
        {
          path: "/docs/1",
          blockId: "1",
          content: "replacement content about cats",
        },
      ]);
      expect(await fts.getSize()).toBe(1);
      const results = await collect(
        fts.search({ queries: ["cats"], topK: 10 }),
      );
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.blockId).toBe("1");
    });

    it("deleteDocuments removes block", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      await fts.addDocument([
        { path: "/docs/1", blockId: "1", content: "hello world" },
      ]);
      await fts.deleteDocuments([{ path: "/docs/1", blockId: "1" }]);
      expect(await fts.getSize()).toBe(0);
    });

    it("getSize counts blocks", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      await fts.addDocument([
        { path: "/docs/1", blockId: "1", content: "first" },
        { path: "/docs/1", blockId: "2", content: "second" },
      ]);
      expect(await fts.getSize()).toBe(2);
    });

    it("search ranks fixture queries with Hit@10 >= 75%", async () => {
      const indexer = getIndexer();
      const blocks = loadBlocksFixture();
      const queries = loadQueriesFixture();

      const index = await indexer.createIndex({
        name: "quality",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());

      const blockIdToFile = new Map<string, string>();
      let blockNum = 1;
      for (const [fileName, docBlocks] of Object.entries(blocks)) {
        for (const [, block] of Object.entries(docBlocks)) {
          const blockId = String(blockNum);
          await fts.addDocument([
            {
              path: `/${fileName}` as `/${string}`,
              blockId,
              content: block.text,
            },
          ]);
          blockIdToFile.set(blockId, fileName);
          blockNum++;
        }
      }

      let hits = 0;
      for (const q of queries) {
        const results = await collect(
          fts.search({ queries: [q.query], topK: 10 }),
        );
        const topFiles = results.map((r) => blockIdToFile.get(r.blockId));
        if (topFiles.includes(q.expectedTopPath)) hits++;
      }

      const hitRate = hits / queries.length;
      expect(
        hitRate,
        `FTS Hit@10 = ${(hitRate * 100).toFixed(0)}%, expected >= 75%`,
      ).toBeGreaterThanOrEqual(0.75);
    });
  });
}
