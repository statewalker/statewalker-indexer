import type { Indexer, IndexerPersistence } from "@repo/indexer-api";
import { afterEach, beforeEach, describe } from "vitest";
import { runBatchOperationsSuite } from "./suites/batch-operations.suite.js";
import { runDocumentPathsSuite } from "./suites/document-paths.suite.js";
import { runErrorHandlingSuite } from "./suites/error-handling.suite.js";
import { runFullTextIndexSuite } from "./suites/full-text-index.suite.js";
import { runIndexSuite } from "./suites/index.suite.js";
import { runIndexerSuite } from "./suites/indexer.suite.js";
import { runLifecycleSuite } from "./suites/lifecycle.suite.js";
import { runMultiIndexerIsolationSuite } from "./suites/multi-indexer-isolation.suite.js";
import { runMultiSearchSuite } from "./suites/multi-search.suite.js";
import { runPersistenceSuite } from "./suites/persistence.suite.js";
import { runSearchQualitySuite } from "./suites/search-quality.suite.js";
import { runSemanticIndexSuite } from "./suites/semantic-index.suite.js";
import { runVectorIndexSuite } from "./suites/vector-index.suite.js";

export interface IndexerFactory {
  create(): Promise<Indexer>;
  /** If provided, creates an indexer with persistence support */
  createWithPersistence?(persistence: IndexerPersistence): Promise<Indexer>;
  cleanup?(): Promise<void>;
}

export function runIndexerTestSuite(
  name: string,
  factory: IndexerFactory,
): void {
  describe(name, () => {
    let indexer: Indexer;

    beforeEach(async () => {
      indexer = await factory.create();
    });

    afterEach(async () => {
      try {
        await indexer.close();
      } catch {
        // may already be closed by the test
      }
      await factory.cleanup?.();
    });

    runIndexerSuite(() => indexer);
    runIndexSuite(() => indexer);
    runFullTextIndexSuite(() => indexer);
    runVectorIndexSuite(() => indexer);
    runDocumentPathsSuite(() => indexer);
    runSemanticIndexSuite(() => indexer);
    runBatchOperationsSuite(() => indexer);
    runLifecycleSuite(() => indexer);
    runErrorHandlingSuite(() => indexer);

    runSearchQualitySuite(() => indexer);
    runMultiSearchSuite(() => indexer);
    runMultiIndexerIsolationSuite(factory.create);

    if (factory.createWithPersistence) {
      runPersistenceSuite(factory);
    }
  });
}
