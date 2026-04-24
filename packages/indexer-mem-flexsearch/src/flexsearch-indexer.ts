import type { Indexer, IndexerPersistence } from "@statewalker/indexer-api";
import { createPersistenceBackedIndexer } from "@statewalker/indexer-core";
import { MemVectorIndex } from "@statewalker/indexer-mem";
import { FlexSearchFullTextIndex } from "./flexsearch-full-text-index.js";

export interface FlexSearchIndexerOptions {
  persistence?: IndexerPersistence;
}

export function createFlexSearchIndexer(options?: FlexSearchIndexerOptions): Indexer {
  return createPersistenceBackedIndexer<FlexSearchFullTextIndex, MemVectorIndex>({
    persistence: options?.persistence,
    createFts: (info) => new FlexSearchFullTextIndex(info),
    serializeFts: (fts) => fts.serialize(),
    deserializeFts: (info, data) => FlexSearchFullTextIndex.deserialize(info, data),
    createVec: (info) => new MemVectorIndex(info),
    serializeVec: (vec) => vec.serializeToArrow(),
    deserializeVec: (info, data) => MemVectorIndex.deserializeFromArrow(info, data),
  });
}
