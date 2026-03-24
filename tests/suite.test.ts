import { runIndexerTestSuite } from "@repo/indexer-tests";
import { createPGLiteIndexer } from "../src/pglite-indexer.js";

runIndexerTestSuite("PGLite Indexer", {
  create: () => createPGLiteIndexer(),
});
