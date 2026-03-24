import type { IndexerPersistence, PersistenceEntry } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../fixtures/index.js";
import type { IndexerFactory } from "../suite-runner.js";
import { defined } from "./test-utils.js";

class MemoryPersistence implements IndexerPersistence {
  private store = new Map<string, Uint8Array[]>();

  async save(entries: AsyncIterable<PersistenceEntry>): Promise<void> {
    this.store.clear();
    for await (const entry of entries) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of entry.content) {
        chunks.push(chunk);
      }
      this.store.set(entry.name, chunks);
    }
  }

  async *load(): AsyncIterable<PersistenceEntry> {
    for (const [name, chunks] of this.store) {
      yield {
        name,
        content: (async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        })(),
      };
    }
  }
}

export function runPersistenceSuite(factory: IndexerFactory): void {
  describe("Persistence", () => {
    it("saves and restores indexes", async () => {
      const persistence = new MemoryPersistence();
      const indexer = defined(
        await factory.createWithPersistence?.(persistence),
        "createWithPersistence should return an indexer",
      );

      await indexer.createIndex({
        name: "test-fts",
        fulltext: { language: "en" },
      });
      await indexer.createIndex({
        name: "test-vec",
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });

      const ftsIndex = defined(await indexer.getIndex("test-fts"));
      await ftsIndex.addDocument({ blockId: "1", content: "hello world" });
      await ftsIndex.addDocument({ blockId: "2", content: "foo bar baz" });

      const vecIndex = defined(await indexer.getIndex("test-vec"));
      const emb1 = new Float32Array(EMBEDDING_DIMENSIONS).fill(0.1);
      const emb2 = new Float32Array(EMBEDDING_DIMENSIONS).fill(0.9);
      await vecIndex.addDocument({ blockId: "10", embedding: emb1 });
      await vecIndex.addDocument({ blockId: "20", embedding: emb2 });

      await indexer.close();

      const indexer2 = defined(
        await factory.createWithPersistence?.(persistence),
      );
      expect(await indexer2.hasIndex("test-fts")).toBe(true);
      expect(await indexer2.hasIndex("test-vec")).toBe(true);

      const ftsIndex2 = defined(await indexer2.getIndex("test-fts"));
      expect(await ftsIndex2.getSize()).toBe(2);
      expect(await ftsIndex2.hasDocument("1")).toBe(true);
      expect(await ftsIndex2.hasDocument("2")).toBe(true);

      const vecIndex2 = defined(await indexer2.getIndex("test-vec"));
      expect(await vecIndex2.getSize()).toBe(2);
      expect(await vecIndex2.hasDocument("10")).toBe(true);
      expect(await vecIndex2.hasDocument("20")).toBe(true);

      await indexer2.close();
    });

    it("restored FTS index is searchable", async () => {
      const persistence = new MemoryPersistence();
      const indexer = defined(
        await factory.createWithPersistence?.(persistence),
      );

      await indexer.createIndex({
        name: "searchable",
        fulltext: { language: "en" },
      });
      const index = defined(await indexer.getIndex("searchable"));
      await index.addDocument({
        blockId: "1",
        content: "typescript programming language",
      });
      await index.addDocument({
        blockId: "2",
        content: "python machine learning",
      });
      await indexer.close();

      const indexer2 = defined(
        await factory.createWithPersistence?.(persistence),
      );
      const index2 = defined(await indexer2.getIndex("searchable"));
      const ftsResults = await index2.search({ query: "typescript", topK: 5 });
      expect(ftsResults.length).toBeGreaterThan(0);
      expect(ftsResults[0]?.blockId).toBe("1");
      await indexer2.close();
    });

    it("restored vector index is searchable", async () => {
      const persistence = new MemoryPersistence();
      const indexer = defined(
        await factory.createWithPersistence?.(persistence),
      );

      await indexer.createIndex({
        name: "searchable-vec",
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      const index = defined(await indexer.getIndex("searchable-vec"));
      const emb1 = new Float32Array(EMBEDDING_DIMENSIONS).fill(0.1);
      const emb2 = new Float32Array(EMBEDDING_DIMENSIONS).fill(0.9);
      await index.addDocument({ blockId: "1", embedding: emb1 });
      await index.addDocument({ blockId: "2", embedding: emb2 });
      await indexer.close();

      const indexer2 = defined(
        await factory.createWithPersistence?.(persistence),
      );
      const index2 = defined(await indexer2.getIndex("searchable-vec"));
      const queryEmb = new Float32Array(EMBEDDING_DIMENSIONS).fill(0.85);
      const vecResults = await index2.search({ embedding: queryEmb, topK: 5 });
      expect(vecResults.length).toBeGreaterThan(0);
      expect(vecResults[0]?.blockId).toBe("2");
      await indexer2.close();
    });

    it("multiple indexes survive round-trip", async () => {
      const persistence = new MemoryPersistence();
      const indexer = defined(
        await factory.createWithPersistence?.(persistence),
      );

      await indexer.createIndex({
        name: "idx-a",
        fulltext: { language: "en" },
      });
      await indexer.createIndex({
        name: "idx-b",
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      await indexer.createIndex({
        name: "idx-c",
        fulltext: { language: "fr" },
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });

      const idxA = defined(await indexer.getIndex("idx-a"));
      await idxA.addDocument({ blockId: "1", content: "alpha content" });

      const idxB = defined(await indexer.getIndex("idx-b"));
      const emb = new Float32Array(EMBEDDING_DIMENSIONS).fill(0.5);
      await idxB.addDocument({ blockId: "2", embedding: emb });

      const idxC = defined(await indexer.getIndex("idx-c"));
      const emb2 = new Float32Array(EMBEDDING_DIMENSIONS).fill(0.3);
      await idxC.addDocument({
        blockId: "3",
        content: "charlie content",
        embedding: emb2,
      });

      await indexer.close();

      const indexer2 = defined(
        await factory.createWithPersistence?.(persistence),
      );
      const names = await indexer2.getIndexNames();
      expect(names).toHaveLength(3);
      const sortedNames = names.map((n) => n.name).sort();
      expect(sortedNames).toEqual(["idx-a", "idx-b", "idx-c"]);

      const idxA2 = defined(await indexer2.getIndex("idx-a"));
      expect(await idxA2.getSize()).toBe(1);
      expect(idxA2.getFullTextIndex()).not.toBeNull();
      expect(idxA2.getVectorIndex()).toBeNull();

      const idxB2 = defined(await indexer2.getIndex("idx-b"));
      expect(await idxB2.getSize()).toBe(1);
      expect(idxB2.getFullTextIndex()).toBeNull();
      expect(idxB2.getVectorIndex()).not.toBeNull();

      const idxC2 = defined(await indexer2.getIndex("idx-c"));
      expect(await idxC2.getSize()).toBe(1);
      expect(idxC2.getFullTextIndex()).not.toBeNull();
      expect(idxC2.getVectorIndex()).not.toBeNull();

      await indexer2.close();
    });
  });
}
