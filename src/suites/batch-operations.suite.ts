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
    it("addDocuments with sync iterable", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      const batches = [
        [{ path: "/docs/1" as const, blockId: "1", content: "first document" }],
        [
          {
            path: "/docs/2" as const,
            blockId: "2",
            content: "second document",
          },
        ],
      ];
      await fts.addDocuments(batches);
      expect(await fts.getSize()).toBe(2);
    });

    it("addDocuments with async iterable", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());

      async function* asyncBatches() {
        yield [
          {
            path: "/docs/1" as const,
            blockId: "1",
            content: "first document",
          },
        ];
        yield [
          {
            path: "/docs/2" as const,
            blockId: "2",
            content: "second document",
          },
        ];
      }

      await fts.addDocuments(asyncBatches());
      expect(await fts.getSize()).toBe(2);
    });

    it("deleteDocuments with async iterable", async () => {
      const indexer = getIndexer();
      const index = await indexer.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      const fts = defined(index.getFullTextIndex());
      await fts.addDocuments([
        [{ path: "/docs/1" as const, blockId: "1", content: "first" }],
        [{ path: "/docs/2" as const, blockId: "2", content: "second" }],
        [{ path: "/docs/3" as const, blockId: "3", content: "third" }],
      ]);

      async function* selectors() {
        yield { path: "/docs/1" as const, blockId: "1" };
        yield { path: "/docs/3" as const, blockId: "3" };
      }

      await fts.deleteDocuments(selectors());
      expect(await fts.getSize()).toBe(1);
    });

    it("batch operations on hybrid index with fixture blocks", async () => {
      const indexer = getIndexer();
      const blocks = loadBlocksFixture();

      const index = await indexer.createIndex({
        name: "hybrid",
        fulltext: { language: "en" },
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });

      let blockNum = 1;
      const batches: Array<
        Array<{
          path: `/${string}`;
          blockId: string;
          content: string;
          embedding: Float32Array;
        }>
      > = [];
      for (const [fileName, docBlocks] of Object.entries(blocks)) {
        const batch: Array<{
          path: `/${string}`;
          blockId: string;
          content: string;
          embedding: Float32Array;
        }> = [];
        for (const [, block] of Object.entries(docBlocks)) {
          batch.push({
            path: `/${fileName}` as `/${string}`,
            blockId: String(blockNum),
            content: block.text,
            embedding: new Float32Array(block.embedding),
          });
          blockNum++;
        }
        batches.push(batch);
      }

      await index.addDocuments(batches);
      expect(await index.getSize()).toBe(blockNum - 1);
    });
  });
}
