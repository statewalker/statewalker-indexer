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
import { defined } from "./test-utils.js";

export function runSemanticIndexSuite(getIndexer: () => Indexer): void {
  describe("SemanticIndex", () => {
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
      const semantic = new SemanticIndex(index, embedFn);
      await semantic.addDocument({
        path: "/test/1",
        blockId: "1",
        content: "hello world",
      });
      await semantic.search({ query: "hello", topK: 10 });
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
      const semantic = new SemanticIndex(index, embedFn);
      await semantic.search({
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
      const semantic = new SemanticIndex(index, embedFn);
      await semantic.addDocument({
        path: "/test/1",
        blockId: "1",
        content: "original",
        embeddingContent: "enriched",
      });
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
      const semantic = new SemanticIndex(index, embedFn);
      await semantic.addDocument({
        path: "/test/1",
        blockId: "1",
        content: "hello",
      });
      expect(embedFn).not.toHaveBeenCalled();
    });

    it("delegates getSize", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const embedFn = createFixtureEmbedFn();
      const semantic = new SemanticIndex(index, embedFn);
      await semantic.addDocument({
        path: "/test/1",
        blockId: "1",
        content: "hello",
      });
      expect(await semantic.getSize()).toBe(1);
    });

    it("delegates deleteDocuments", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const embedFn = createFixtureEmbedFn();
      const semantic = new SemanticIndex(index, embedFn);
      await semantic.addDocument({
        path: "/test/1",
        blockId: "1",
        content: "hello",
      });
      await semantic.deleteDocuments([{ path: "/test/1", blockId: "1" }]);
      expect(await semantic.getSize()).toBe(0);
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
      const semantic = new SemanticIndex(index, embedFn);
      const blocks = loadBlocksFixture();
      const queries = loadQueriesFixture();

      for (const [fileName, docBlocks] of Object.entries(blocks)) {
        let blockNum = 1;
        for (const [, block] of Object.entries(docBlocks)) {
          await semantic.addDocument({
            path: `/${fileName}` as `/${string}`,
            blockId: `${fileName}-${blockNum}`,
            content: block.text,
          });
          blockNum++;
        }
      }

      const q = defined(queries[0]);
      const results = await semantic.search({ query: q.query, topK: 10 });
      expect(results.length).toBeGreaterThan(0);
    });
  });
}
