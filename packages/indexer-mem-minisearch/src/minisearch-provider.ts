import {
  FULL_TEXT_TYPE,
  type FullTextConfig,
  type FullTextProvider,
} from "@statewalker/indexer-fulltext";
import { MiniSearchFullTextIndex } from "./minisearch-full-text-index.js";

/**
 * `FullTextProvider` backed by {@link MiniSearchFullTextIndex}. Wired into an
 * `Indexer` alongside a `VectorProvider` to compose a full-text + vector
 * Indexer.
 */
export const miniSearchFullTextProvider: FullTextProvider = {
  type: FULL_TEXT_TYPE,
  create(config: FullTextConfig): MiniSearchFullTextIndex {
    return new MiniSearchFullTextIndex({
      language: config.language,
      metadata: config.metadata,
    });
  },
};
