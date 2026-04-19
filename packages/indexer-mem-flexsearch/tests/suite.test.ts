import { runIndexerTestSuite } from "@statewalker/indexer-tests";
import { createFlexSearchIndexer } from "../src/flexsearch-indexer.js";

runIndexerTestSuite("FlexSearch Indexer", {
  create: async () => createFlexSearchIndexer(),
  createWithPersistence: async (persistence) => createFlexSearchIndexer({ persistence }),
});
