import type { Indexer } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../fixtures/index.js";

export function runCollectionsSuite(getIndexer: () => Indexer): void {
  describe("Collections", () => {
    describe("FTS-only index", () => {
      async function createFtsIndex(indexer: Indexer) {
        return indexer.createIndex({
          name: "coll-fts",
          fulltext: { language: "en" },
        });
      }

      it("documents without collectionId default to _default", async () => {
        const index = await createFtsIndex(getIndexer());
        await index.addDocument({ blockId: "1", content: "hello world" });
        expect(await index.getCollections()).toContain("_default");
        expect(await index.hasDocument("1", "_default")).toBe(true);
      });

      it("documents in different collections are isolated on search", async () => {
        const index = await createFtsIndex(getIndexer());
        await index.addDocument({
          blockId: "1",
          content: "the quick brown fox",
          collectionId: "a",
        });
        await index.addDocument({
          blockId: "2",
          content: "the lazy brown dog",
          collectionId: "b",
        });

        const resultsA = await index.search({
          query: "brown",
          topK: 10,
          collections: "a",
        });
        expect(resultsA.length).toBe(1);
        expect(resultsA[0]?.blockId).toBe("1");

        const resultsB = await index.search({
          query: "brown",
          topK: 10,
          collections: "b",
        });
        expect(resultsB.length).toBe(1);
        expect(resultsB[0]?.blockId).toBe("2");
      });

      it("search without collections filter returns all", async () => {
        const index = await createFtsIndex(getIndexer());
        await index.addDocument({
          blockId: "1",
          content: "the quick brown fox",
          collectionId: "a",
        });
        await index.addDocument({
          blockId: "2",
          content: "the lazy brown dog",
          collectionId: "b",
        });

        const results = await index.search({ query: "brown", topK: 10 });
        expect(results.length).toBe(2);
      });

      it("search with array of collections returns union", async () => {
        const index = await createFtsIndex(getIndexer());
        await index.addDocument({
          blockId: "1",
          content: "alpha beta",
          collectionId: "a",
        });
        await index.addDocument({
          blockId: "2",
          content: "alpha gamma",
          collectionId: "b",
        });
        await index.addDocument({
          blockId: "3",
          content: "alpha delta",
          collectionId: "c",
        });

        const results = await index.search({
          query: "alpha",
          topK: 10,
          collections: ["a", "b"],
        });
        const ids = results.map((r) => r.blockId).sort();
        expect(ids).toEqual(["1", "2"]);
      });

      it("hasDocument with collectionId checks only that collection", async () => {
        const index = await createFtsIndex(getIndexer());
        await index.addDocument({
          blockId: "1",
          content: "hello",
          collectionId: "a",
        });
        expect(await index.hasDocument("1", "a")).toBe(true);
        expect(await index.hasDocument("1", "b")).toBe(false);
      });

      it("hasDocument without collectionId checks all collections", async () => {
        const index = await createFtsIndex(getIndexer());
        await index.addDocument({
          blockId: "1",
          content: "hello",
          collectionId: "a",
        });
        expect(await index.hasDocument("1")).toBe(true);
      });

      it("getSize with collectionId counts only that collection", async () => {
        const index = await createFtsIndex(getIndexer());
        await index.addDocument({
          blockId: "1",
          content: "hello",
          collectionId: "a",
        });
        await index.addDocument({
          blockId: "2",
          content: "world",
          collectionId: "b",
        });
        expect(await index.getSize("a")).toBe(1);
        expect(await index.getSize("b")).toBe(1);
        expect(await index.getSize()).toBe(2);
      });

      it("deleteDocument with collectionId removes only from that collection", async () => {
        const index = await createFtsIndex(getIndexer());
        await index.addDocument({
          blockId: "1",
          content: "hello",
          collectionId: "a",
        });
        await index.addDocument({
          blockId: "1",
          content: "world",
          collectionId: "b",
        });
        await index.deleteDocument("1", "a");
        expect(await index.hasDocument("1", "a")).toBe(false);
        expect(await index.hasDocument("1", "b")).toBe(true);
      });

      it("deleteCollection removes all docs in that collection", async () => {
        const index = await createFtsIndex(getIndexer());
        await index.addDocument({
          blockId: "1",
          content: "hello",
          collectionId: "a",
        });
        await index.addDocument({
          blockId: "2",
          content: "world",
          collectionId: "a",
        });
        await index.addDocument({
          blockId: "3",
          content: "foo",
          collectionId: "b",
        });
        await index.deleteCollection("a");
        expect(await index.getSize("a")).toBe(0);
        expect(await index.getSize("b")).toBe(1);
        expect(await index.hasDocument("1")).toBe(false);
        expect(await index.hasDocument("3")).toBe(true);
      });

      it("getCollections returns all known collection IDs", async () => {
        const index = await createFtsIndex(getIndexer());
        await index.addDocument({
          blockId: "1",
          content: "hello",
          collectionId: "x",
        });
        await index.addDocument({
          blockId: "2",
          content: "world",
          collectionId: "y",
        });
        await index.addDocument({
          blockId: "3",
          content: "foo",
          collectionId: "z",
        });
        const collections = await index.getCollections();
        expect(collections.sort()).toEqual(["x", "y", "z"]);
      });

      it("same blockId can exist in different collections", async () => {
        const index = await createFtsIndex(getIndexer());
        await index.addDocument({
          blockId: "1",
          content: "alpha content",
          collectionId: "a",
        });
        await index.addDocument({
          blockId: "1",
          content: "beta content",
          collectionId: "b",
        });
        expect(await index.getSize()).toBe(2);
        expect(await index.hasDocument("1", "a")).toBe(true);
        expect(await index.hasDocument("1", "b")).toBe(true);

        const resultsA = await index.search({
          query: "alpha",
          topK: 10,
          collections: "a",
        });
        expect(resultsA.length).toBe(1);
        expect(resultsA[0]?.blockId).toBe("1");

        const resultsB = await index.search({
          query: "alpha",
          topK: 10,
          collections: "b",
        });
        expect(resultsB.length).toBe(0);
      });

      it("search results include collectionId", async () => {
        const index = await createFtsIndex(getIndexer());
        await index.addDocument({
          blockId: "1",
          content: "hello world",
          collectionId: "a",
        });
        const results = await index.search({
          query: "hello",
          topK: 10,
          collections: "a",
        });
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]?.collectionId).toBe("a");
      });

      it("multi-collection isolation: each collection returns only its own docs", async () => {
        const index = await createFtsIndex(getIndexer());
        // Index many docs across 3 collections with shared keyword "report"
        await index.addDocument({
          blockId: "a1",
          content: "quarterly report for finance",
          collectionId: "finance",
        });
        await index.addDocument({
          blockId: "a2",
          content: "annual report for finance division",
          collectionId: "finance",
        });
        await index.addDocument({
          blockId: "b1",
          content: "engineering report on performance",
          collectionId: "engineering",
        });
        await index.addDocument({
          blockId: "b2",
          content: "report on infrastructure upgrades",
          collectionId: "engineering",
        });
        await index.addDocument({
          blockId: "b3",
          content: "report on deployment pipeline",
          collectionId: "engineering",
        });
        await index.addDocument({
          blockId: "c1",
          content: "marketing report on campaign results",
          collectionId: "marketing",
        });

        // Search "report" in finance — expect exactly 2 docs, both from finance
        const financeResults = await index.search({
          query: "report",
          topK: 10,
          collections: "finance",
        });
        const financeIds = financeResults.map((r) => r.blockId).sort();
        expect(financeIds).toEqual(["a1", "a2"]);
        for (const r of financeResults) {
          expect(r.collectionId).toBe("finance");
        }

        // Search "report" in engineering — expect exactly 3 docs
        const engResults = await index.search({
          query: "report",
          topK: 10,
          collections: "engineering",
        });
        const engIds = engResults.map((r) => r.blockId).sort();
        expect(engIds).toEqual(["b1", "b2", "b3"]);
        for (const r of engResults) {
          expect(r.collectionId).toBe("engineering");
        }

        // Search "report" in marketing — expect exactly 1 doc
        const mktResults = await index.search({
          query: "report",
          topK: 10,
          collections: "marketing",
        });
        expect(mktResults.length).toBe(1);
        expect(mktResults[0]?.blockId).toBe("c1");
        expect(mktResults[0]?.collectionId).toBe("marketing");

        // Search "report" across finance + marketing — expect 3 docs, none from engineering
        const combinedResults = await index.search({
          query: "report",
          topK: 10,
          collections: ["finance", "marketing"],
        });
        const combinedIds = combinedResults.map((r) => r.blockId).sort();
        expect(combinedIds).toEqual(["a1", "a2", "c1"]);
        for (const r of combinedResults) {
          expect(["finance", "marketing"]).toContain(r.collectionId);
        }

        // Search "report" without filter — expect all 6
        const allResults = await index.search({
          query: "report",
          topK: 10,
        });
        expect(allResults.length).toBe(6);
      });
    });

    describe("Vector-only index", () => {
      async function createVecIndex(indexer: Indexer) {
        return indexer.createIndex({
          name: "coll-vec",
          vector: { dimensionality: 3, model: "test" },
        });
      }

      it("documents in different collections are isolated on search", async () => {
        const index = await createVecIndex(getIndexer());
        await index.addDocument({
          blockId: "1",
          embedding: new Float32Array([1, 0, 0]),
          collectionId: "a",
        });
        await index.addDocument({
          blockId: "2",
          embedding: new Float32Array([0.9, 0.1, 0]),
          collectionId: "b",
        });

        const resultsA = await index.search({
          embedding: new Float32Array([1, 0, 0]),
          topK: 10,
          collections: "a",
        });
        expect(resultsA.length).toBe(1);
        expect(resultsA[0]?.blockId).toBe("1");
      });

      it("search without collections filter returns all", async () => {
        const index = await createVecIndex(getIndexer());
        await index.addDocument({
          blockId: "1",
          embedding: new Float32Array([1, 0, 0]),
          collectionId: "a",
        });
        await index.addDocument({
          blockId: "2",
          embedding: new Float32Array([0, 1, 0]),
          collectionId: "b",
        });

        const results = await index.search({
          embedding: new Float32Array([1, 0, 0]),
          topK: 10,
        });
        expect(results.length).toBe(2);
      });

      it("same blockId in different collections with different embeddings", async () => {
        const index = await createVecIndex(getIndexer());
        await index.addDocument({
          blockId: "1",
          embedding: new Float32Array([1, 0, 0]),
          collectionId: "a",
        });
        await index.addDocument({
          blockId: "1",
          embedding: new Float32Array([0, 1, 0]),
          collectionId: "b",
        });

        const resultsA = await index.search({
          embedding: new Float32Array([1, 0, 0]),
          topK: 10,
          collections: "a",
        });
        expect(resultsA.length).toBe(1);
        expect(resultsA[0]?.score).toBeCloseTo(1.0, 1);

        const resultsB = await index.search({
          embedding: new Float32Array([1, 0, 0]),
          topK: 10,
          collections: "b",
        });
        expect(resultsB.length).toBe(1);
        expect(resultsB[0]?.score).toBeCloseTo(0.0, 1);
      });

      it("deleteCollection removes vector docs", async () => {
        const index = await createVecIndex(getIndexer());
        await index.addDocument({
          blockId: "1",
          embedding: new Float32Array([1, 0, 0]),
          collectionId: "a",
        });
        await index.addDocument({
          blockId: "2",
          embedding: new Float32Array([0, 1, 0]),
          collectionId: "b",
        });
        await index.deleteCollection("a");
        expect(await index.getSize("a")).toBe(0);
        expect(await index.getSize("b")).toBe(1);
      });

      it("search results include collectionId", async () => {
        const index = await createVecIndex(getIndexer());
        await index.addDocument({
          blockId: "1",
          embedding: new Float32Array([1, 0, 0]),
          collectionId: "x",
        });
        const results = await index.search({
          embedding: new Float32Array([1, 0, 0]),
          topK: 10,
          collections: "x",
        });
        expect(results.length).toBe(1);
        expect(results[0]?.collectionId).toBe("x");
      });

      it("multi-collection isolation: each collection returns only its own embeddings", async () => {
        const index = await createVecIndex(getIndexer());
        // 3 collections, query is close to [1,0,0]
        await index.addDocument({
          blockId: "a1",
          embedding: new Float32Array([0.9, 0.1, 0]),
          collectionId: "red",
        });
        await index.addDocument({
          blockId: "a2",
          embedding: new Float32Array([0.8, 0.2, 0]),
          collectionId: "red",
        });
        await index.addDocument({
          blockId: "b1",
          embedding: new Float32Array([0.7, 0.3, 0]),
          collectionId: "green",
        });
        await index.addDocument({
          blockId: "c1",
          embedding: new Float32Array([0.6, 0.4, 0]),
          collectionId: "blue",
        });
        await index.addDocument({
          blockId: "c2",
          embedding: new Float32Array([0.5, 0.5, 0]),
          collectionId: "blue",
        });

        const query = new Float32Array([1, 0, 0]);

        // red only — expect exactly a1, a2
        const redResults = await index.search({
          embedding: query,
          topK: 10,
          collections: "red",
        });
        const redIds = redResults.map((r) => r.blockId).sort();
        expect(redIds).toEqual(["a1", "a2"]);
        for (const r of redResults) {
          expect(r.collectionId).toBe("red");
        }

        // green only — expect exactly b1
        const greenResults = await index.search({
          embedding: query,
          topK: 10,
          collections: "green",
        });
        expect(greenResults.length).toBe(1);
        expect(greenResults[0]?.blockId).toBe("b1");

        // blue only — expect exactly c1, c2
        const blueResults = await index.search({
          embedding: query,
          topK: 10,
          collections: "blue",
        });
        const blueIds = blueResults.map((r) => r.blockId).sort();
        expect(blueIds).toEqual(["c1", "c2"]);

        // red + blue — expect 4 docs, none from green
        const rbResults = await index.search({
          embedding: query,
          topK: 10,
          collections: ["red", "blue"],
        });
        const rbIds = rbResults.map((r) => r.blockId).sort();
        expect(rbIds).toEqual(["a1", "a2", "c1", "c2"]);

        // no filter — all 5
        const allResults = await index.search({
          embedding: query,
          topK: 10,
        });
        expect(allResults.length).toBe(5);
      });
    });

    describe("Hybrid index", () => {
      async function createHybridIndex(indexer: Indexer) {
        return indexer.createIndex({
          name: "coll-hybrid",
          fulltext: { language: "en" },
          vector: {
            dimensionality: EMBEDDING_DIMENSIONS,
            model: EMBEDDING_MODEL,
          },
        });
      }

      it("hybrid search respects collection filter", async () => {
        const index = await createHybridIndex(getIndexer());
        const emb1 = new Float32Array(EMBEDDING_DIMENSIONS);
        emb1[0] = 1.0;
        const emb2 = new Float32Array(EMBEDDING_DIMENSIONS);
        emb2[1] = 1.0;

        await index.addDocument({
          blockId: "1",
          content: "machine learning algorithms",
          embedding: emb1,
          collectionId: "a",
        });
        await index.addDocument({
          blockId: "2",
          content: "machine learning models",
          embedding: emb2,
          collectionId: "b",
        });

        const resultsA = await index.search({
          query: "machine learning",
          embedding: emb1,
          topK: 10,
          collections: "a",
        });
        expect(resultsA.length).toBe(1);
        expect(resultsA[0]?.blockId).toBe("1");
      });

      it("getCollections works with hybrid index", async () => {
        const index = await createHybridIndex(getIndexer());
        const emb = new Float32Array(EMBEDDING_DIMENSIONS);
        emb[0] = 1.0;
        await index.addDocument({
          blockId: "1",
          content: "hello",
          embedding: emb,
          collectionId: "col-1",
        });
        await index.addDocument({
          blockId: "2",
          content: "world",
          embedding: emb,
          collectionId: "col-2",
        });
        const collections = await index.getCollections();
        expect(collections.sort()).toEqual(["col-1", "col-2"]);
      });

      it("deleteDocument with collectionId in hybrid index", async () => {
        const index = await createHybridIndex(getIndexer());
        const emb = new Float32Array(EMBEDDING_DIMENSIONS);
        emb[0] = 1.0;
        await index.addDocument({
          blockId: "1",
          content: "hello",
          embedding: emb,
          collectionId: "a",
        });
        await index.addDocument({
          blockId: "1",
          content: "world",
          embedding: emb,
          collectionId: "b",
        });
        await index.deleteDocument("1", "a");
        expect(await index.hasDocument("1", "a")).toBe(false);
        expect(await index.hasDocument("1", "b")).toBe(true);
        expect(await index.getSize()).toBe(1);
      });
    });

    describe("FullTextIndex sub-index collections", () => {
      it("addDocument/search with collectionId on FTS sub-index", async () => {
        const indexer = getIndexer();
        const index = await indexer.createIndex({
          name: "fts-sub",
          fulltext: { language: "en" },
        });
        const fts = index.getFullTextIndex()!;
        expect(fts).not.toBeNull();

        await fts.addDocument({
          blockId: "1",
          content: "alpha beta",
          collectionId: "c1",
        });
        await fts.addDocument({
          blockId: "2",
          content: "alpha gamma",
          collectionId: "c2",
        });

        const resultsC1 = await fts.search({
          query: "alpha",
          topK: 10,
          collections: "c1",
        });
        expect(resultsC1.length).toBe(1);
        expect(resultsC1[0]?.blockId).toBe("1");

        const resultsAll = await fts.search({
          query: "alpha",
          topK: 10,
        });
        expect(resultsAll.length).toBe(2);
      });

      it("getCollections on FTS sub-index", async () => {
        const indexer = getIndexer();
        const index = await indexer.createIndex({
          name: "fts-coll",
          fulltext: { language: "en" },
        });
        const fts = index.getFullTextIndex()!;
        await fts.addDocument({
          blockId: "1",
          content: "hello",
          collectionId: "x",
        });
        await fts.addDocument({
          blockId: "2",
          content: "world",
          collectionId: "y",
        });
        const collections = await fts.getCollections();
        expect(collections.sort()).toEqual(["x", "y"]);
      });
    });

    describe("VectorIndex sub-index collections", () => {
      it("addDocument/search with collectionId on vector sub-index", async () => {
        const indexer = getIndexer();
        const index = await indexer.createIndex({
          name: "vec-sub",
          vector: { dimensionality: 3, model: "test" },
        });
        const vec = index.getVectorIndex()!;
        expect(vec).not.toBeNull();

        await vec.addDocument({
          blockId: "1",
          embedding: new Float32Array([1, 0, 0]),
          collectionId: "c1",
        });
        await vec.addDocument({
          blockId: "2",
          embedding: new Float32Array([0.9, 0.1, 0]),
          collectionId: "c2",
        });

        const resultsC1 = await vec.search({
          embedding: new Float32Array([1, 0, 0]),
          topK: 10,
          collections: "c1",
        });
        expect(resultsC1.length).toBe(1);
        expect(resultsC1[0]?.blockId).toBe("1");

        const resultsAll = await vec.search({
          embedding: new Float32Array([1, 0, 0]),
          topK: 10,
        });
        expect(resultsAll.length).toBe(2);
      });

      it("getCollections on vector sub-index", async () => {
        const indexer = getIndexer();
        const index = await indexer.createIndex({
          name: "vec-coll",
          vector: { dimensionality: 3, model: "test" },
        });
        const vec = index.getVectorIndex()!;
        await vec.addDocument({
          blockId: "1",
          embedding: new Float32Array([1, 0, 0]),
          collectionId: "p",
        });
        await vec.addDocument({
          blockId: "2",
          embedding: new Float32Array([0, 1, 0]),
          collectionId: "q",
        });
        const collections = await vec.getCollections();
        expect(collections.sort()).toEqual(["p", "q"]);
      });
    });
  });
}
