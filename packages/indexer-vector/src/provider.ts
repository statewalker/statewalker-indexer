import type { ModalityProvider } from "@statewalker/indexer-api";
import type { VECTOR_TYPE, VectorConfig, VectorIndex } from "./types.js";

/**
 * Typed `ModalityProvider` for the vector modality. A backend that supports
 * vector search exports one of these (with a concrete `create` building its
 * `VectorIndex` impl) and wires it into the Indexer at construction time.
 */
export interface VectorProvider extends ModalityProvider<VectorConfig, VectorIndex> {
  readonly type: typeof VECTOR_TYPE;
  create(config: VectorConfig): VectorIndex;
}
