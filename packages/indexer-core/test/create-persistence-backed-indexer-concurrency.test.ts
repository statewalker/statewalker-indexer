import type {
  EmbeddingIndexInfo,
  FullTextIndexInfo,
  IndexerPersistence,
  PersistenceEntry,
} from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";
import { createPersistenceBackedIndexer } from "../src/create-persistence-backed-indexer.js";

interface DummyFts {
  info: FullTextIndexInfo;
  closed: boolean;
  close(): Promise<void>;
}

interface DummyVec {
  info: EmbeddingIndexInfo;
  closed: boolean;
  close(): Promise<void>;
}

const dummyPersistence: IndexerPersistence = {
  // biome-ignore lint/correctness/useYield: empty load — no manifest in fresh fixture
  async *load(): AsyncIterable<PersistenceEntry> {
    return;
  },
  async save() {
    return;
  },
};

describe("createPersistenceBackedIndexer — concurrent createIndex serialisation", () => {
  it("two overlapping createIndex(overwrite:true) calls produce exactly one indexed entry, no leaked sub-indexes", async () => {
    const fts: DummyFts[] = [];
    const vec: DummyVec[] = [];

    const indexer = createPersistenceBackedIndexer<DummyFts, DummyVec>({
      persistence: dummyPersistence,
      createFts: (info) => {
        const f: DummyFts = {
          info,
          closed: false,
          async close() {
            this.closed = true;
          },
        };
        fts.push(f);
        return f;
      },
      serializeFts: async () => "",
      createVec: (info) => {
        const v: DummyVec = {
          info,
          closed: false,
          async close() {
            this.closed = true;
          },
        };
        vec.push(v);
        return v;
      },
      serializeVec: async () => new Uint8Array(),
      // biome-ignore lint/suspicious/noExplicitAny: stub deserialiser, never invoked in this test
      deserializeFts: ((info: FullTextIndexInfo) => ({ info, closed: false }) as any) as never,
      // biome-ignore lint/suspicious/noExplicitAny: stub deserialiser, never invoked in this test
      deserializeVec: ((info: EmbeddingIndexInfo) => ({ info, closed: false }) as any) as never,
    });

    // Seed an existing index so both concurrent calls hit the overwrite branch.
    await indexer.createIndex({
      name: "race",
      fulltext: { language: "en" },
    });
    // Two concurrent overwrite calls — without the mutex these interleave and
    // produce a stranded sub-index instance.
    await Promise.all([
      indexer.createIndex({ name: "race", fulltext: { language: "en" }, overwrite: true }),
      indexer.createIndex({ name: "race", fulltext: { language: "en" }, overwrite: true }),
    ]);

    expect(await indexer.hasIndex("race")).toBe(true);
    const live = await indexer.getIndex("race");
    expect(live).not.toBeNull();

    // Three FTS instances were constructed (1 initial + 2 overwrites). Two of
    // them must be closed; one stays alive as the current index.
    expect(fts.length).toBe(3);
    const liveCount = fts.filter((f) => !f.closed).length;
    expect(liveCount).toBe(1);

    await indexer.close();
  });
});
