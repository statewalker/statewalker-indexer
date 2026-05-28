import type { Indexer, IndexerPersistence } from "@statewalker/indexer-api";
import { createPersistenceBackedIndexer } from "@statewalker/indexer-core";
import { memVectorProvider } from "@statewalker/indexer-mem";
import { flexSearchFullTextProvider } from "./flexsearch-provider.js";

export interface FlexSearchIndexerOptions {
  persistence?: IndexerPersistence;
}

/**
 * In-memory Indexer combining FlexSearch full-text and brute-force vector
 * sub-indexes via the Provider model. Multiple sub-indexes of either modality
 * can be created on one Index (e.g. English and French FTS sub-indexes).
 */
export function createFlexSearchIndexer(options?: FlexSearchIndexerOptions): Indexer {
  return createPersistenceBackedIndexer({
    persistence: options?.persistence,
    providers: [flexSearchFullTextProvider, memVectorProvider],
  });
}
