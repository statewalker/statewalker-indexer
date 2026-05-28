import type { ModalityProvider } from "@statewalker/indexer-api";
import type { FULL_TEXT_TYPE, FullTextConfig, FullTextIndex } from "./types.js";

/**
 * Typed `ModalityProvider` for the full-text modality. A backend that supports
 * full-text search exports one of these (with a concrete `create` building its
 * `FullTextIndex` impl) and wires it into the Indexer at construction time.
 */
export interface FullTextProvider extends ModalityProvider<FullTextConfig, FullTextIndex> {
  readonly type: typeof FULL_TEXT_TYPE;
  create(config: FullTextConfig): FullTextIndex;
}
