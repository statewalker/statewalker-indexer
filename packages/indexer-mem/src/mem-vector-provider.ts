import { VECTOR_TYPE, type VectorConfig, type VectorProvider } from "@statewalker/indexer-vector";
import { MemVectorIndex } from "./mem-vector-index.js";

/**
 * `VectorProvider` backed by {@link MemVectorIndex} — the in-memory brute-force
 * vector store. Wired into an `Indexer` at construction time via
 * `createPersistenceBackedIndexer({ providers: [memVectorProvider] })`.
 */
export const memVectorProvider: VectorProvider = {
  type: VECTOR_TYPE,
  create(config: VectorConfig): MemVectorIndex {
    return new MemVectorIndex({
      dimensionality: config.dimensionality,
      model: config.model,
      metadata: config.metadata,
    });
  },
};
