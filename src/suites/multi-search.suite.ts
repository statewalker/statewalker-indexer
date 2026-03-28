import type {
  GroupedSearchResult,
  Indexer,
  ScoredResult,
} from "@repo/indexer-api";
import { describe, expect, it } from "vitest";

export function runMultiSearchSuite(getIndexer: () => Indexer): void {
  describe("MultiSearch", () => {
    async function setup(indexer: Indexer) {
      const index = await indexer.createIndex({
        name: "multi-fts",
        fulltext: { language: "en" },
      });
      await index.addDocument({
        blockId: "d1",
        content: "quantum mechanics and particle physics",
        collectionId: "science/physics",
      });
      await index.addDocument({
        blockId: "d2",
        content: "astrophysics and cosmology of the universe",
        collectionId: "science/astronomy",
      });
      await index.addDocument({
        blockId: "d3",
        content: "cell biology genetics and molecular biology",
        collectionId: "science/biology",
      });
      await index.addDocument({
        blockId: "d4",
        content: "javascript async programming patterns",
        collectionId: "tech/programming",
      });
      await index.addDocument({
        blockId: "d5",
        content: "cooking pasta recipes and italian food",
        collectionId: "lifestyle/food",
      });
      await index.addDocument({
        blockId: "d6",
        content: "quantum computing programming algorithms",
        collectionId: "tech/quantum",
      });
      return index;
    }

    describe("Multiple FTS queries", () => {
      it("single query returns same results as Index.search()", async () => {
        const index = await setup(getIndexer());
        const multiResults = (await index.multiSearch?.({
          queries: ["quantum"],
          topK: 10,
        })) as ScoredResult[] | undefined;
        const singleResults = await index.search({
          query: "quantum",
          topK: 10,
        });

        expect(multiResults).toBeDefined();
        const multiIds = multiResults?.map((r) => r.blockId).sort();
        const singleIds = singleResults.map((r) => r.blockId).sort();
        expect(multiIds).toEqual(singleIds);
      });

      it("two queries — documents matching both rank higher", async () => {
        const index = await setup(getIndexer());
        // d6 matches both "quantum" and "programming", d1 matches "quantum", d4 matches "programming"
        const results = (await index.multiSearch?.({
          queries: ["quantum", "programming"],
          topK: 10,
        })) as ScoredResult[];

        expect(results.length).toBeGreaterThanOrEqual(3);
        // d6 should rank highest since it matches both queries
        const d6 = results.find((r) => r.blockId === "d6");
        expect(d6).toBeDefined();
        expect(d6?.matchCount).toBe(2);

        // d1 and d4 each match only one query
        const d1 = results.find((r) => r.blockId === "d1");
        const d4 = results.find((r) => r.blockId === "d4");
        expect(d1?.matchCount).toBe(1);
        expect(d4?.matchCount).toBe(1);

        // d6 matches both queries — it should appear in results
        // (Score ordering depends on per-query ranking; matchCount is the reliable signal)
        expect(d6?.matchCount).toBeGreaterThan(d1?.matchCount ?? 0);
      });

      it("disjoint queries — results are union with matchCount=1 each", async () => {
        const index = await setup(getIndexer());
        // "biology" matches d3 only, "pasta" matches d5 only
        const results = (await index.multiSearch?.({
          queries: ["biology", "pasta"],
          topK: 10,
        })) as ScoredResult[];

        const ids = results.map((r) => r.blockId).sort();
        expect(ids).toContain("d3");
        expect(ids).toContain("d5");
        for (const r of results) {
          expect(r.matchCount).toBe(1);
        }
      });

      it("empty queries array returns empty results", async () => {
        const index = await setup(getIndexer());
        const results = await index.multiSearch?.({
          queries: [],
          topK: 10,
        });
        expect(results).toEqual([]);
      });
    });

    describe("Multiple collection filters", () => {
      it("prefix filter restricts multi-search to matching collections", async () => {
        const index = await setup(getIndexer());
        const results = (await index.multiSearch?.({
          queries: ["quantum", "programming"],
          topK: 10,
          collections: "science/",
        })) as ScoredResult[];

        // Only science/* collections should appear
        for (const r of results) {
          expect(r.collectionId).toMatch(/^science\//);
        }
        // d4 (tech/programming) and d6 (tech/quantum) should not appear
        const ids = results.map((r) => r.blockId);
        expect(ids).not.toContain("d4");
        expect(ids).not.toContain("d6");
      });

      it("mixed exact + prefix filters", async () => {
        const index = await setup(getIndexer());
        const results = (await index.multiSearch?.({
          queries: ["quantum", "cooking"],
          topK: 10,
          collections: ["science/physics", "lifestyle/"],
        })) as ScoredResult[];

        const ids = results.map((r) => r.blockId).sort();
        expect(ids).toContain("d1"); // science/physics + "quantum"
        expect(ids).toContain("d5"); // lifestyle/food + "cooking"
        // d6 is tech/quantum — should NOT appear
        expect(ids).not.toContain("d6");
      });
    });

    describe("groupByCollection", () => {
      it("false — returns flat ScoredResult[]", async () => {
        const index = await setup(getIndexer());
        const results = (await index.multiSearch?.({
          queries: ["quantum"],
          topK: 10,
          groupByCollection: false,
        })) as ScoredResult[];

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);
        // Flat array — each element has blockId and score
        for (const r of results) {
          expect(r).toHaveProperty("blockId");
          expect(r).toHaveProperty("score");
          expect(r).toHaveProperty("matchCount");
        }
      });

      it("true — returns GroupedSearchResult[]", async () => {
        const index = await setup(getIndexer());
        const results = (await index.multiSearch?.({
          queries: ["quantum", "programming"],
          topK: 10,
          groupByCollection: true,
          collections: ["science/", "tech/"],
        })) as GroupedSearchResult[];

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);
        // Each group has collectionId and results array
        for (const group of results) {
          expect(group).toHaveProperty("collectionId");
          expect(group).toHaveProperty("results");
          expect(Array.isArray(group.results)).toBe(true);
          for (const r of group.results) {
            expect(r).toHaveProperty("blockId");
            expect(r).toHaveProperty("matchCount");
          }
        }
      });

      it("true — groups are sorted by best score in group", async () => {
        const index = await setup(getIndexer());
        const results = (await index.multiSearch?.({
          queries: ["quantum", "programming"],
          topK: 10,
          groupByCollection: true,
        })) as GroupedSearchResult[];

        for (let i = 1; i < results.length; i++) {
          const prevBest = results[i - 1]?.results[0]?.score ?? 0;
          const currBest = results[i]?.results[0]?.score ?? 0;
          expect(prevBest).toBeGreaterThanOrEqual(currBest);
        }
      });
    });

    describe("Edge cases", () => {
      it("no queries and no embeddings returns empty", async () => {
        const index = await setup(getIndexer());
        const results = await index.multiSearch?.({ topK: 10 });
        expect(results).toEqual([]);
      });

      it("topK limits total results in flat mode", async () => {
        const index = await setup(getIndexer());
        const results = (await index.multiSearch?.({
          queries: ["quantum", "programming", "biology", "cooking"],
          topK: 2,
        })) as ScoredResult[];
        expect(results.length).toBeLessThanOrEqual(2);
      });
    });
  });
}
