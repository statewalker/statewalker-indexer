import type { Indexer, IndexerPersistence } from "@statewalker/indexer-api";
import { createPersistenceBackedIndexer } from "@statewalker/indexer-core";
import { MemVectorIndex } from "@statewalker/indexer-mem";
import { MiniSearchFullTextIndex } from "./minisearch-full-text-index.js";

export interface MiniSearchIndexerOptions {
  persistence?: IndexerPersistence;
}

export function createMiniSearchIndexer(options?: MiniSearchIndexerOptions): Indexer {
  return createPersistenceBackedIndexer<MiniSearchFullTextIndex, MemVectorIndex>({
    persistence: options?.persistence,
    createFts: (info) => new MiniSearchFullTextIndex(info),
    serializeFts: (fts) => fts.serialize(),
    deserializeFts: (info, data) => MiniSearchFullTextIndex.deserialize(info, data),
    createVec: (info) => new MemVectorIndex(info),
    serializeVec: (vec) => vec.serializeToArrow(),
    deserializeVec: (info, data) => MemVectorIndex.deserializeFromArrow(info, data),
  });
}
