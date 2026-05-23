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
}
interface DummyVec {
  info: EmbeddingIndexInfo;
}

function dummyOpts(persistence: IndexerPersistence) {
  return {
    persistence,
    // biome-ignore lint/suspicious/noExplicitAny: minimal type-erased stubs for these tests
    createFts: (info: FullTextIndexInfo) => ({ info }) as any,
    serializeFts: () => "",
    // biome-ignore lint/suspicious/noExplicitAny: minimal type-erased stubs for these tests
    deserializeFts: (info: FullTextIndexInfo) => ({ info }) as any,
    // biome-ignore lint/suspicious/noExplicitAny: minimal type-erased stubs for these tests
    createVec: (info: EmbeddingIndexInfo) => ({ info }) as any,
    serializeVec: () => new Uint8Array(),
    // biome-ignore lint/suspicious/noExplicitAny: minimal type-erased stubs for these tests
    deserializeVec: (info: EmbeddingIndexInfo) => ({ info }) as any,
  };
}

describe("createPersistenceBackedIndexer — init failure handling", () => {
  it("does not mark the indexer initialised when persistence.load throws midway", async () => {
    let callCount = 0;
    const failingPersistence: IndexerPersistence = {
      // biome-ignore lint/correctness/useYield: this generator throws midway and yields nothing on retry — that's the scenario under test
      async *load(): AsyncIterable<PersistenceEntry> {
        callCount++;
        if (callCount === 1) throw new Error("transient I/O failure");
        // On the retry: succeed with an empty manifest.
        return;
      },
      async save() {
        return;
      },
    };

    const indexer = createPersistenceBackedIndexer<DummyFts, DummyVec>(
      dummyOpts(failingPersistence),
    );

    // First call: surface the underlying error.
    await expect(indexer.getIndexNames()).rejects.toThrow(/transient I\/O/);

    // Second call: must retry init, not silently succeed against half-loaded state.
    const names = await indexer.getIndexNames();
    expect(names).toEqual([]);
    expect(callCount).toBe(2);
  });
});
