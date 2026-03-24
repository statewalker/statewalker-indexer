import type { Indexer } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  loadBlocksFixture,
} from "../fixtures/index.js";
import { defined } from "./test-utils.js";

export function runBatchOperationsSuite(getIndexer: () => Indexer): void {
  describe("Batch Operations", () => {
    it("addDocuments with sync Iterable", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());

      const docs = [
        { blockId: "1", content: "first document" },
        { blockId: "2", content: "second document" },
        { blockId: "3", content: "third document" },
      ];
      await fts.addDocuments(docs);
      expect(await fts.getSize()).toBe(3);
    });

    it("addDocuments with AsyncIterable", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());

      async function* generateDocs() {
        yield { blockId: "1", content: "first document" };
        yield { blockId: "2", content: "second document" };
        yield { blockId: "3", content: "third document" };
      }
      await fts.addDocuments(generateDocs());
      expect(await fts.getSize()).toBe(3);
    });

    it("deleteDocuments with sync Iterable", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      await fts.addDocuments([
        { blockId: "1", content: "one" },
        { blockId: "2", content: "two" },
        { blockId: "3", content: "three" },
      ]);
      await fts.deleteDocuments(["1", "3"]);
      expect(await fts.getSize()).toBe(1);
      expect(await fts.hasDocument("2")).toBe(true);
    });

    it("deleteDocuments with AsyncIterable", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        vector: { dimensionality: 3, model: "test" },
      });
      const vec = defined(index.getVectorIndex());
      await vec.addDocuments([
        { blockId: "1", embedding: new Float32Array([1, 0, 0]) },
        { blockId: "2", embedding: new Float32Array([0, 1, 0]) },
        { blockId: "3", embedding: new Float32Array([0, 0, 1]) },
      ]);

      async function* ids() {
        yield "1";
        yield "3";
      }
      await vec.deleteDocuments(ids());
      expect(await vec.getSize()).toBe(1);
      expect(await vec.hasDocument("2")).toBe(true);
    });

    it("batch addDocuments on Index with fixture blocks", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });

      const blocks = loadBlocksFixture();
      const docs: Array<{
        blockId: string;
        content: string;
        embedding: Float32Array;
      }> = [];
      let blockNum = 1;
      for (const docBlocks of Object.values(blocks)) {
        for (const block of Object.values(docBlocks)) {
          docs.push({
            blockId: String(blockNum),
            content: block.text,
            embedding: new Float32Array(block.embedding),
          });
          blockNum++;
        }
      }

      await index.addDocuments(docs);
      expect(await index.getSize()).toBe(docs.length);
    });
  });
}
