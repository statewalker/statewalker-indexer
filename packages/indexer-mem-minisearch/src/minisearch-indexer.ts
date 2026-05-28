import type { Indexer, IndexerPersistence } from "@statewalker/indexer-api";
import { createPersistenceBackedIndexer } from "@statewalker/indexer-core";
import { memVectorProvider } from "@statewalker/indexer-mem";
import { miniSearchFullTextProvider } from "./minisearch-provider.js";

export interface MiniSearchIndexerOptions {
  persistence?: IndexerPersistence;
}

/**
 * In-memory Indexer combining MiniSearch full-text and brute-force vector
 * sub-indexes via the Provider model. Multiple sub-indexes of either modality
 * can be created on one Index (e.g. English and French FTS sub-indexes).
 */
export function createMiniSearchIndexer(options?: MiniSearchIndexerOptions): Indexer {
  return createPersistenceBackedIndexer({
    persistence: options?.persistence,
    providers: [miniSearchFullTextProvider, memVectorProvider],
  });
}
