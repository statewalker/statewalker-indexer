import type { Db } from "@statewalker/db-api";
import type { Indexer } from "@statewalker/indexer-api";
import { createSqlIndexer } from "@statewalker/indexer-core";
import { duckdbDialect, wrapDbAsSqlDb } from "./dialect.js";

export interface DuckDbIndexerOptions {
  db: Db;
}

/**
 * DuckDB-backed `Indexer` over the open-registry contract.
 *
 * Wires the per-Index docs table, per-sub-index FTS / vector tables, and the
 * `__indexer_manifest` table via `createSqlIndexer`. FTS uses DuckDB's `fts`
 * extension (BM25 scoring, rebuilt lazily after writes); vectors use the
 * `vss` extension with HNSW + `array_cosine_distance`.
 */
export function createDuckDbIndexer(options: DuckDbIndexerOptions): Promise<Indexer> {
  return createSqlIndexer({
    db: wrapDbAsSqlDb(options.db),
    dialect: duckdbDialect,
  });
}
