import type { IndexerPersistence, PersistenceEntry } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../fixtures/index.js";
import type { IndexerFactory } from "../suite-runner.js";
import { collect, defined } from "./test-utils.js";

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

  async *load(): AsyncGenerator<PersistenceEntry> {
    for (const [name, chunks] of this.store) {
      yield {
        name,
        content: (async function* () {
          for (const chunk of chunks) yield chunk;
        })(),
      };
    }
  }
}

export function runPersistenceSuite(factory: IndexerFactory): void {
  describe("Persistence", () => {
    it("FTS index survives save/restore round-trip", async () => {
      const persistence = new MemoryPersistence();
      const createWithPersistence = defined(factory.createWithPersistence);

      // Create and populate
      const indexer1 = await createWithPersistence(persistence);
      const index1 = await indexer1.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await index1.addDocument([
        { path: "/docs/1", blockId: "1", content: "the quick brown fox" },
      ]);
      await indexer1.flush();
      await indexer1.close();

      // Restore and verify
      const indexer2 = await createWithPersistence(persistence);
      const index2 = await indexer2.getIndex("test");
      expect(index2).not.toBeNull();
      const fts = defined(defined(index2).getFullTextIndex());
      expect(await fts.getSize()).toBe(1);
      const results = await collect(fts.search({ queries: ["fox"], topK: 10 }));
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.blockId).toBe("1");
      await indexer2.close();
    });

    it("vector index survives save/restore round-trip", async () => {
      const persistence = new MemoryPersistence();
      const createWithPersistence = defined(factory.createWithPersistence);

      const indexer1 = await createWithPersistence(persistence);
      const index1 = await indexer1.createIndex({
        name: "test",
        vector: { dimensionality: 3, model: "test" },
      });
      await index1.addDocument([
        {
          path: "/test/1",
          blockId: "1",
          embedding: new Float32Array([1, 0, 0]),
        },
      ]);
      await indexer1.flush();
      await indexer1.close();

      const indexer2 = await createWithPersistence(persistence);
      const index2 = defined(await indexer2.getIndex("test"));
      const vec = defined(index2.getVectorIndex());
      expect(await vec.getSize()).toBe(1);
      const results = await collect(
        vec.search({
          embeddings: [new Float32Array([0.9, 0.1, 0])],
          topK: 2,
        }),
      );
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.blockId).toBe("1");
      await indexer2.close();
    });

    it("multiple indexes survive round-trip", async () => {
      const persistence = new MemoryPersistence();
      const createWithPersistence = defined(factory.createWithPersistence);

      const indexer1 = await createWithPersistence(persistence);
      await indexer1.createIndex({
        name: "alpha",
        fulltext: { language: "en" },
      });
      await indexer1.createIndex({
        name: "beta",
        vector: { dimensionality: 3, model: "test" },
      });
      await indexer1.flush();
      await indexer1.close();

      const indexer2 = await createWithPersistence(persistence);
      expect(await indexer2.hasIndex("alpha")).toBe(true);
      expect(await indexer2.hasIndex("beta")).toBe(true);
      const names = await indexer2.getIndexNames();
      expect(names).toHaveLength(2);
      await indexer2.close();
    });

    it("index metadata preserved across round-trip", async () => {
      const persistence = new MemoryPersistence();
      const createWithPersistence = defined(factory.createWithPersistence);

      const indexer1 = await createWithPersistence(persistence);
      const index1 = await indexer1.createIndex({
        name: "test",
        fulltext: { language: "en" },
        vector: {
          dimensionality: EMBEDDING_DIMENSIONS,
          model: EMBEDDING_MODEL,
        },
      });
      const ftsInfo1 = await defined(index1.getFullTextIndex()).getIndexInfo();
      const vecInfo1 = await defined(index1.getVectorIndex()).getIndexInfo();
      await indexer1.flush();
      await indexer1.close();

      const indexer2 = await createWithPersistence(persistence);
      const index2 = defined(await indexer2.getIndex("test"));
      const ftsInfo2 = await defined(index2.getFullTextIndex()).getIndexInfo();
      const vecInfo2 = await defined(index2.getVectorIndex()).getIndexInfo();
      expect(ftsInfo2.language).toBe(ftsInfo1.language);
      expect(vecInfo2.dimensionality).toBe(vecInfo1.dimensionality);
      expect(vecInfo2.model).toBe(vecInfo1.model);
      await indexer2.close();
    });
  });
}
