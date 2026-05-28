// =============================================================================
// Shared conformance-suite types.
//
// All conformance suites are parameterised on these factory shapes; the
// concrete backend test files supply them.
// =============================================================================

import type { Indexer, IndexerPersistence } from "@statewalker/indexer-api";

export interface IndexerFactory {
  /** Construct a fresh Indexer. */
  create(): Promise<Indexer>;
  /** Construct an Indexer wired with the given persistence backend. */
  createWithPersistence?(persistence: IndexerPersistence): Promise<Indexer>;
  /** Per-test teardown hook (close DBs, remove temp files, …). */
  cleanup?(): Promise<void>;
}
