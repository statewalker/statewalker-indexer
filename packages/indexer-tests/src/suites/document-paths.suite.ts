import type { Indexer } from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";
import { collect, defined } from "./test-utils.js";

export function runDocumentPathsSuite(getIndexer: () => Indexer): void {
  describe("Document Paths", () => {
    // --- Path isolation ---

    it("search with paths filter only returns matching blocks", async () => {
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
      await index.addDocument([
        { path: "/science/biology", blockId: "2", content: "quantum biology" },
      ]);
      await index.addDocument([
        {
          path: "/tech/programming",
          blockId: "3",
          content: "quantum computing",
        },
      ]);

      const results = await collect(
        index.search({ queries: ["quantum"], topK: 10, paths: ["/science/"] }),
      );
      expect(results).toHaveLength(2);
      const blockIds = results.map((r) => r.blockId).sort();
      expect(blockIds).toEqual(["1", "2"]);
    });

    it("search without paths filter returns all documents", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([{ path: "/a/1", blockId: "1", content: "hello world" }]);
      await index.addDocument([{ path: "/b/2", blockId: "2", content: "hello earth" }]);

      const results = await collect(index.search({ queries: ["hello"], topK: 10 }));
      expect(results).toHaveLength(2);
    });

    it("search with multiple path prefixes returns union", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([{ path: "/science/physics", blockId: "1", content: "atoms" }]);
      await index.addDocument([{ path: "/tech/code", blockId: "2", content: "atoms in code" }]);
      await index.addDocument([{ path: "/art/music", blockId: "3", content: "atomic beats" }]);

      const results = await collect(
        index.search({
          queries: ["atoms"],
          topK: 10,
          paths: ["/science/", "/tech/"],
        }),
      );
      expect(results).toHaveLength(2);
    });

    // --- getSize with path prefix ---

    it("getSize with pathPrefix counts only matching blocks", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([
        { path: "/docs/api", blockId: "1", content: "endpoint" },
        { path: "/docs/api", blockId: "2", content: "response" },
      ]);
      await index.addDocument([{ path: "/docs/guide", blockId: "3", content: "tutorial" }]);
      await index.addDocument([{ path: "/blog/post1", blockId: "4", content: "hello" }]);

      expect(await index.getSize("/docs/")).toBe(3);
      expect(await index.getSize("/blog/")).toBe(1);
      expect(await index.getSize()).toBe(4);
    });

    // --- deleteDocuments with path prefix ---

    it("deleteDocuments with path prefix removes all blocks under that path", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([{ path: "/docs/a", blockId: "1", content: "first" }]);
      await index.addDocument([{ path: "/docs/b", blockId: "2", content: "second" }]);
      await index.addDocument([{ path: "/other/c", blockId: "3", content: "third" }]);

      await index.deleteDocuments([{ path: "/docs/" }]);
      expect(await index.getSize()).toBe(1);
      expect(await index.getSize("/docs/")).toBe(0);
      expect(await index.getSize("/other/")).toBe(1);
    });

    it("deleteDocuments with path + blockId removes only that block", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([
        { path: "/docs/a", blockId: "1", content: "first" },
        { path: "/docs/a", blockId: "2", content: "second" },
      ]);

      await index.deleteDocuments([{ path: "/docs/a", blockId: "1" }]);
      expect(await index.getSize()).toBe(1);
    });

    // --- Same blockId under different paths ---

    it("same blockId can exist under different paths", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([
        {
          path: "/en/readme",
          blockId: "intro",
          content: "english introduction",
        },
      ]);
      await index.addDocument([
        {
          path: "/fr/readme",
          blockId: "intro",
          content: "french introduction",
        },
      ]);

      expect(await index.getSize()).toBe(2);

      const enResults = await collect(
        index.search({ queries: ["english"], topK: 10, paths: ["/en/"] }),
      );
      expect(enResults).toHaveLength(1);
      expect(enResults[0]?.path).toBe("/en/readme");

      const frResults = await collect(
        index.search({ queries: ["french"], topK: 10, paths: ["/fr/"] }),
      );
      expect(frResults).toHaveLength(1);
      expect(frResults[0]?.path).toBe("/fr/readme");
    });

    // --- Enumeration ---

    it("getDocumentPaths yields all unique paths", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([
        { path: "/docs/a", blockId: "1", content: "first" },
        { path: "/docs/a", blockId: "2", content: "second" },
      ]);
      await index.addDocument([{ path: "/docs/b", blockId: "3", content: "third" }]);

      const paths = await collect(index.getDocumentPaths());
      expect(paths.sort()).toEqual(["/docs/a", "/docs/b"]);
    });

    it("getDocumentPaths with pathPrefix yields only matching", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([{ path: "/docs/a", blockId: "1", content: "first" }]);
      await index.addDocument([{ path: "/blog/b", blockId: "2", content: "second" }]);

      const paths = await collect(index.getDocumentPaths("/docs/"));
      expect(paths).toEqual(["/docs/a"]);
    });

    it("getDocumentBlocksRefs yields all block references", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([
        { path: "/docs/a", blockId: "1", content: "first" },
        { path: "/docs/a", blockId: "2", content: "second" },
      ]);

      const refs = await collect(index.getDocumentBlocksRefs());
      expect(refs).toHaveLength(2);
      const ids = refs.map((r) => r.blockId).sort();
      expect(ids).toEqual(["1", "2"]);
      for (const ref of refs) {
        expect(ref.path).toBe("/docs/a");
      }
    });

    it("getDocumentsBlocks yields full block data", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index.addDocument([{ path: "/docs/a", blockId: "1", content: "hello world" }]);

      const blocks = await collect(index.getDocumentsBlocks());
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.blockId).toBe("1");
      expect(blocks[0]?.path).toBe("/docs/a");
      expect(blocks[0]?.content).toBe("hello world");
    });

    it("getDocumentsBlocks scales linearly with block count (regression: O(N²) bug)", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const N = 500;
      const batch = [];
      for (let i = 0; i < N; i++) {
        batch.push({ path: `/docs/p${i}`, blockId: `b${i}`, content: `content-${i}` });
      }
      await index.addDocument(batch);

      const start = Date.now();
      const blocks = await collect(index.getDocumentsBlocks());
      const duration = Date.now() - start;

      expect(blocks).toHaveLength(N);
      // O(N) should be well under 1s for 500 blocks; O(N²) would take 2+ seconds
      // Use a generous 3s ceiling as a sharp signal against quadratic regressions.
      expect(duration).toBeLessThan(3000);
    });

    // --- Path prefix filtering on sub-indexes ---

    it("FTS sub-index respects path prefix in search", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      await fts.addDocument([{ path: "/science/1", blockId: "1", content: "quantum physics" }]);
      await fts.addDocument([{ path: "/tech/1", blockId: "2", content: "quantum computing" }]);

      const results = await collect(
        fts.search({ queries: ["quantum"], topK: 10, paths: ["/science/"] }),
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.blockId).toBe("1");
    });

    it("EmbeddingIndex sub-index respects path prefix in search", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: { dimensionality: 3, model: "test" },
      });
      const vec = defined(index.getVectorIndex());
      await vec.addDocument([
        {
          path: "/science/1",
          blockId: "1",
          embedding: new Float32Array([1, 0, 0]),
        },
      ]);
      await vec.addDocument([
        {
          path: "/tech/1",
          blockId: "2",
          embedding: new Float32Array([0.9, 0.1, 0]),
        },
      ]);

      const results = await collect(
        vec.search({
          embeddings: [new Float32Array([1, 0, 0])],
          topK: 10,
          paths: ["/science/"],
        }),
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.blockId).toBe("1");
    });
  });
}
