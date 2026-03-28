import type { Indexer } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../fixtures/index.js";

export function runCollectionPrefixSuite(getIndexer: () => Indexer): void {
  describe("Collection Prefix Filtering", () => {
    describe("FTS search with prefix filter", () => {
      async function setup(indexer: Indexer) {
        const index = await indexer.createIndex({
          name: "prefix-fts",
          fulltext: { language: "en" },
        });
        await index.addDocument({
          blockId: "d1",
          content: "quantum mechanics and physics",
          collectionId: "science/physics",
        });
        await index.addDocument({
          blockId: "d2",
          content: "astrophysics and cosmology",
          collectionId: "science/astronomy",
        });
        await index.addDocument({
          blockId: "d3",
          content: "cell biology and genetics",
          collectionId: "science/biology",
        });
        await index.addDocument({
          blockId: "d4",
          content: "javascript async programming",
          collectionId: "tech/programming",
        });
        await index.addDocument({
          blockId: "d5",
          content: "photography composition techniques",
          collectionId: "tech/photography",
        });
        await index.addDocument({
          blockId: "d6",
          content: "cooking pasta recipes",
          collectionId: "lifestyle/food",
        });
        return index;
      }

      it("prefix 'science/' returns results from all science/* collections", async () => {
        const index = await setup(getIndexer());
        // "quantum" only in science/physics
        const results = await index.search({
          query: "quantum",
          topK: 10,
          collections: "science/",
        });
        expect(results.length).toBe(1);
        expect(results[0]?.blockId).toBe("d1");
        expect(results[0]?.collectionId).toBe("science/physics");
      });

      it("prefix 'tech/' returns results from tech/* only", async () => {
        const index = await setup(getIndexer());
        // Search a term present in both tech collections
        const results = await index.search({
          query: "programming photography",
          topK: 10,
          collections: "tech/",
        });
        const ids = results.map((r) => r.blockId).sort();
        expect(ids).toEqual(["d4", "d5"]);
        for (const r of results) {
          expect(r.collectionId).toMatch(/^tech\//);
        }
      });

      it("exact collection ID returns only that collection", async () => {
        const index = await setup(getIndexer());
        const results = await index.search({
          query: "quantum",
          topK: 10,
          collections: "science/physics",
        });
        expect(results.length).toBe(1);
        expect(results[0]?.collectionId).toBe("science/physics");
      });

      it("mixed array of prefix + exact returns union", async () => {
        const index = await setup(getIndexer());
        const results = await index.search({
          query: "quantum cooking programming photography biology cosmology",
          topK: 10,
          collections: ["tech/", "lifestyle/food"],
        });
        const ids = results.map((r) => r.blockId).sort();
        expect(ids).toEqual(["d4", "d5", "d6"]);
      });

      it("prefix with no matches returns empty", async () => {
        const index = await setup(getIndexer());
        const results = await index.search({
          query: "quantum",
          topK: 10,
          collections: "nonexistent/",
        });
        expect(results.length).toBe(0);
      });

      it("no filter returns results from all collections", async () => {
        const index = await setup(getIndexer());
        const results = await index.search({
          query: "quantum cooking programming photography biology cosmology",
          topK: 10,
        });
        expect(results.length).toBe(6);
      });

      it("prefix does not match partial segment", async () => {
        const index = await setup(getIndexer());
        // "sci/" should NOT match "science/physics"
        const results = await index.search({
          query: "quantum",
          topK: 10,
          collections: "sci/",
        });
        expect(results.length).toBe(0);
      });

      it("deeper prefix narrows results further", async () => {
        const index = await setup(getIndexer());
        // "science/p" is not a prefix (no trailing /), treated as exact match
        const resultsExact = await index.search({
          query: "quantum",
          topK: 10,
          collections: "science/p",
        });
        expect(resultsExact.length).toBe(0);
      });
    });

    describe("Vector search with prefix filter", () => {
      async function setup(indexer: Indexer) {
        const index = await indexer.createIndex({
          name: "prefix-vec",
          vector: { dimensionality: 3, model: "test" },
        });
        await index.addDocument({
          blockId: "v1",
          embedding: new Float32Array([1, 0, 0]),
          collectionId: "docs/api/v1",
        });
        await index.addDocument({
          blockId: "v2",
          embedding: new Float32Array([0.9, 0.1, 0]),
          collectionId: "docs/api/v2",
        });
        await index.addDocument({
          blockId: "v3",
          embedding: new Float32Array([0.8, 0.2, 0]),
          collectionId: "docs/guides",
        });
        await index.addDocument({
          blockId: "v4",
          embedding: new Float32Array([0.5, 0.5, 0]),
          collectionId: "blog/2026",
        });
        return index;
      }

      it("prefix 'docs/' returns only docs/* embeddings", async () => {
        const index = await setup(getIndexer());
        const results = await index.search({
          embedding: new Float32Array([1, 0, 0]),
          topK: 10,
          collections: "docs/",
        });
        const ids = results.map((r) => r.blockId).sort();
        expect(ids).toEqual(["v1", "v2", "v3"]);
      });

      it("prefix 'docs/api/' returns only docs/api/* embeddings", async () => {
        const index = await setup(getIndexer());
        const results = await index.search({
          embedding: new Float32Array([1, 0, 0]),
          topK: 10,
          collections: "docs/api/",
        });
        const ids = results.map((r) => r.blockId).sort();
        expect(ids).toEqual(["v1", "v2"]);
      });

      it("exact + prefix mix works correctly", async () => {
        const index = await setup(getIndexer());
        const results = await index.search({
          embedding: new Float32Array([1, 0, 0]),
          topK: 10,
          collections: ["docs/api/", "blog/2026"],
        });
        const ids = results.map((r) => r.blockId).sort();
        expect(ids).toEqual(["v1", "v2", "v4"]);
      });

      it("prefix with no matches returns empty", async () => {
        const index = await setup(getIndexer());
        const results = await index.search({
          embedding: new Float32Array([1, 0, 0]),
          topK: 10,
          collections: "archive/",
        });
        expect(results.length).toBe(0);
      });
    });

    describe("Hybrid search with prefix filter", () => {
      it("prefix filter applies to both FTS and vector sub-indexes", async () => {
        const indexer = getIndexer();
        const index = await indexer.createIndex({
          name: "prefix-hybrid",
          fulltext: { language: "en" },
          vector: {
            dimensionality: EMBEDDING_DIMENSIONS,
            model: EMBEDDING_MODEL,
          },
        });

        const emb1 = new Float32Array(EMBEDDING_DIMENSIONS);
        emb1[0] = 1.0;
        const emb2 = new Float32Array(EMBEDDING_DIMENSIONS);
        emb2[1] = 1.0;

        await index.addDocument({
          blockId: "h1",
          content: "machine learning algorithms",
          embedding: emb1,
          collectionId: "tech/ml",
        });
        await index.addDocument({
          blockId: "h2",
          content: "machine learning models",
          embedding: emb2,
          collectionId: "research/ml",
        });

        const results = await index.search({
          query: "machine learning",
          embedding: emb1,
          topK: 10,
          collections: "tech/",
        });
        expect(results.length).toBe(1);
        expect(results[0]?.blockId).toBe("h1");
        expect(results[0]?.collectionId).toBe("tech/ml");
      });
    });
  });
}
