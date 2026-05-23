import type { Indexer } from "@statewalker/indexer-api";
import { embedAndAdd, embedAndSearch } from "@statewalker/indexer-search";
import { describe, expect, it, vi } from "vitest";
import {
  createFixtureEmbedFn,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  loadBlocksFixture,
  loadQueriesFixture,
} from "../fixtures/index.js";
import { defined } from "./test-utils.js";

export function runSemanticIndexSuite(getIndexer: () => Indexer): void {
  describe("embed helpers", () => {
    it("embeds query text on search", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });

      const embedFn = vi.fn(createFixtureEmbedFn());
      await embedAndAdd(index, embedFn, [
        {
          path: "/test/1",
          blockId: "1",
          content: "hello world",
        },
      ]);
      await embedAndSearch(index, embedFn, { query: "hello", topK: 10 });
      expect(embedFn).toHaveBeenCalled();
    });

    it("uses semanticQuery for embedding when provided", async () => {
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
      await embedAndSearch(index, embedFn, {
        query: "original",
        semanticQuery: "rewritten",
        topK: 10,
      });
      expect(calls).toContain("rewritten");
      expect(calls).not.toContain("original");
    });

    it("uses embeddingContent for document embedding when provided", async () => {
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
      await embedAndAdd(index, embedFn, [
        {
          path: "/test/1",
          blockId: "1",
          content: "original",
          embeddingContent: "enriched",
        },
      ]);
      expect(calls).toContain("enriched");
      expect(calls).not.toContain("original");
    });

    it("skips embedding when no vector sub-index", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });

      const embedFn = vi.fn(async () => new Float32Array(EMBEDDING_DIMENSIONS));
      await embedAndAdd(index, embedFn, [
        {
          path: "/test/1",
          blockId: "1",
          content: "hello",
        },
      ]);
      expect(embedFn).not.toHaveBeenCalled();
    });

    it("ingested documents are visible to index.getSize", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const embedFn = createFixtureEmbedFn();
      await embedAndAdd(index, embedFn, [
        {
          path: "/test/1",
          blockId: "1",
          content: "hello",
        },
      ]);
      expect(await index.getSize()).toBe(1);
    });

    it("index.deleteDocuments removes helper-added docs", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const embedFn = createFixtureEmbedFn();
      await embedAndAdd(index, embedFn, [
        {
          path: "/test/1",
          blockId: "1",
          content: "hello",
        },
      ]);
      await index.deleteDocuments([{ path: "/test/1", blockId: "1" }]);
      expect(await index.getSize()).toBe(0);
    });

    it("end-to-end search with fixture blocks", async () => {
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
      const blocks = loadBlocksFixture();
      const queries = loadQueriesFixture();

      for (const [fileName, docBlocks] of Object.entries(blocks)) {
        let blockNum = 1;
        for (const [, block] of Object.entries(docBlocks)) {
          await embedAndAdd(index, embedFn, [
            {
              path: `/${fileName}` as `/${string}`,
              blockId: `${fileName}-${blockNum}`,
              content: block.text,
            },
          ]);
          blockNum++;
        }
      }

      const q = defined(queries[0]);
      const results = await embedAndSearch(index, embedFn, { query: q.query, topK: 10 });
      expect(results.length).toBeGreaterThan(0);
    });
  });
}
