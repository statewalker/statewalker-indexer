import {
  FULL_TEXT_TYPE,
  type FullTextConfig,
  type FullTextProvider,
} from "@statewalker/indexer-fulltext";
import { FlexSearchFullTextIndex } from "./flexsearch-full-text-index.js";

/**
 * `FullTextProvider` backed by {@link FlexSearchFullTextIndex}. Wired into an
 * `Indexer` alongside a `VectorProvider` to compose a full-text + vector
 * Indexer.
 */
export const flexSearchFullTextProvider: FullTextProvider = {
  type: FULL_TEXT_TYPE,
  create(config: FullTextConfig): FlexSearchFullTextIndex {
    return new FlexSearchFullTextIndex({
      language: config.language,
      metadata: config.metadata,
    });
  },
};
