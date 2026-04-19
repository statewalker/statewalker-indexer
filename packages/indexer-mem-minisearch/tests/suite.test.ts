import { runIndexerTestSuite } from "@statewalker/indexer-tests";
import { createMiniSearchIndexer } from "../src/minisearch-indexer.js";

runIndexerTestSuite("MiniSearch Indexer", {
  create: async () => createMiniSearchIndexer(),
  createWithPersistence: async (persistence) => createMiniSearchIndexer({ persistence }),
});
