import type { Indexer } from "@statewalker/indexer-api";
import { defaultMultiSearch } from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";

export function runMultiSearchSuite(getIndexer: () => Indexer): void {
  describe("Multi-Search (defaultMultiSearch)", () => {
    it("returns results for multiple text queries", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([{ path: "/docs/1", blockId: "1", content: "the quick brown fox" }]);
      await index.addDocument([{ path: "/docs/2", blockId: "2", content: "lazy sleeping dog" }]);
      await index.addDocument([{ path: "/docs/3", blockId: "3", content: "the fox and the dog" }]);

      const results = await defaultMultiSearch(index, {
        queries: ["fox", "dog"],
        topK: 10,
      });
      expect(results.length).toBeGreaterThan(0);
      // Block 3 mentions both fox and dog — should have highest matchCount
      const block3 = results.find((r) => r.blockId === "3");
      expect(block3?.matchCount).toBe(2);
    });

    it("matchCount reflects number of matching queries", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([{ path: "/docs/1", blockId: "1", content: "alpha beta gamma" }]);
      await index.addDocument([{ path: "/docs/2", blockId: "2", content: "only alpha here" }]);

      const results = await defaultMultiSearch(index, {
        queries: ["alpha", "beta", "gamma"],
        topK: 10,
      });
      const r1 = results.find((r) => r.blockId === "1");
      const r2 = results.find((r) => r.blockId === "2");
      expect(r1?.matchCount).toBe(3);
      expect(r2?.matchCount).toBe(1);
    });

    it("returns empty array when no queries provided", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const results = await defaultMultiSearch(index, { topK: 10 });
      expect(results).toEqual([]);
    });

    it("respects topK limit", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      for (let i = 0; i < 20; i++) {
        await index.addDocument([
          {
            path: `/docs/${i}` as `/${string}`,
            blockId: String(i),
            content: `document number ${i} about search`,
          },
        ]);
      }
      const results = await defaultMultiSearch(index, {
        queries: ["search"],
        topK: 5,
      });
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it("supports path filtering", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([
        {
          path: "/science/physics",
          blockId: "1",
          content: "quantum mechanics",
        },
      ]);
      await index.addDocument([{ path: "/tech/code", blockId: "2", content: "quantum computing" }]);

      const results = await defaultMultiSearch(index, {
        queries: ["quantum"],
        topK: 10,
        paths: ["/science/"],
      });
      expect(results.length).toBe(1);
      expect(results[0]?.blockId).toBe("1");
    });
  });
}
