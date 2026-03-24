import type { Indexer } from "@repo/indexer-api";
import { SemanticIndex } from "@repo/indexer-api";
import { describe, expect, it, vi } from "vitest";
import {
  createFixtureEmbedFn,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  loadBlocksFixture,
  loadQueriesFixture,
} from "../fixtures/index.js";

export function runSemanticIndexSuite(getIndexer: () => Indexer): void {
  describe("SemanticIndex", () => {
    it("search embeds query for vector search", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });

      const embedFn = createFixtureEmbedFn();
      const spyEmbed = vi.fn(embedFn);
      const semantic = new SemanticIndex(index, spyEmbed);

      await semantic.addDocument({ blockId: "1", content: "hello world" });
      await semantic.search({ query: "hello", topK: 5 });
      expect(spyEmbed).toHaveBeenCalled();
    });

    it("search uses semanticQuery for embedding when provided", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });

      const calls: string[] = [];
      const embedFn = async (text: string) => {
        calls.push(text);
        return new Float32Array(EMBEDDING_DIMENSIONS);
      };
      const semantic = new SemanticIndex(index, embedFn);

      await semantic.search({
        query: "short query",
        semanticQuery: "expanded semantic query",
        topK: 5,
      });
      expect(calls).toContain("expanded semantic query");
      expect(calls).not.toContain("short query");
    });

    it("addDocument uses embeddingContent for embedding when provided", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });

      const calls: string[] = [];
      const embedFn = async (text: string) => {
        calls.push(text);
        return new Float32Array(EMBEDDING_DIMENSIONS);
      };
      const semantic = new SemanticIndex(index, embedFn);

      await semantic.addDocument({
        blockId: "1",
        content: "short content",
        embeddingContent: "expanded content for embedding",
      });
      expect(calls).toContain("expanded content for embedding");
      expect(calls).not.toContain("short content");
    });

    it("skips embedding when no vector sub-index", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });

      const embedFn = vi.fn(async () => new Float32Array(EMBEDDING_DIMENSIONS));
      const semantic = new SemanticIndex(index, embedFn);

      await semantic.addDocument({ blockId: "1", content: "hello" });
      await semantic.search({ query: "hello", topK: 5 });
      expect(embedFn).not.toHaveBeenCalled();
    });

    it("delegates deleteDocument to underlying index", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const semantic = new SemanticIndex(index, createFixtureEmbedFn());

      await semantic.addDocument({ blockId: "1", content: "hello" });
      expect(await semantic.hasDocument("1")).toBe(true);
      await semantic.deleteDocument("1");
      expect(await semantic.hasDocument("1")).toBe(false);
    });

    it("delegates getSize to underlying index", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const semantic = new SemanticIndex(index, createFixtureEmbedFn());

      await semantic.addDocument({ blockId: "1", content: "one" });
      await semantic.addDocument({ blockId: "2", content: "two" });
      expect(await semantic.getSize()).toBe(2);
    });

    it("close delegates to underlying index", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const semantic = new SemanticIndex(index, createFixtureEmbedFn());
      await semantic.close();
      await expect(semantic.hasDocument("1")).rejects.toThrow();
    });

    it("end-to-end: indexes all fixture blocks and validates search ranking", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "e2e",
        fulltext: { language: "en" },
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });

      const embedFn = createFixtureEmbedFn();
      const semantic = new SemanticIndex(index, embedFn);
      const blocks = loadBlocksFixture();
      const queries = loadQueriesFixture();

      const blockIdToFile = new Map<string, string>();
      let blockNum = 1;
      for (const [fileName, docBlocks] of Object.entries(blocks)) {
        for (const block of Object.values(docBlocks)) {
          const blockId = String(blockNum);
          await semantic.addDocument({ blockId, content: block.text });
          blockIdToFile.set(blockId, fileName);
          blockNum++;
        }
      }

      for (const q of queries) {
        const results = await semantic.search({ query: q.query, topK: 10 });
        expect(
          results.length,
          `query "${q.id}" returned no results`,
        ).toBeGreaterThan(0);
        const topFiles = results
          .slice(0, 5)
          .map((r) => blockIdToFile.get(r.blockId));
        expect(
          topFiles,
          `query "${q.id}" expected "${q.expectedTopPath}" in top 5, got: ${topFiles.join(", ")}`,
        ).toContain(q.expectedTopPath);
      }
    });
  });
}
