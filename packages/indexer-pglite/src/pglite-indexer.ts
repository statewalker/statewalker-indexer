import type { Db } from "@statewalker/db-api";
import type { Indexer } from "@statewalker/indexer-api";
import { createSqlIndexer } from "@statewalker/indexer-core";
import { pgliteDialect } from "./dialect.js";

export interface PGLiteIndexerOptions {
  /** A PGlite-backed `Db` with the pgvector extension loaded. The indexer never closes it. */
  db: Db;
}

/**
 * PGlite-backed `Indexer` over the open-registry contract.
 *
 * Wires the per-Index docs table, per-sub-index FTS / vector tables, and the
 * `__indexer_manifest` table via `createSqlIndexer`. The FTS modality uses
 * PostgreSQL `tsvector` with GIN; the vector modality uses pgvector's
 * `vector(dim)` with HNSW, so `db` must be opened with the vector extension.
 */
export function createPGLiteIndexer(options: PGLiteIndexerOptions): Promise<Indexer> {
  return createSqlIndexer({ db: options.db, dialect: pgliteDialect });
}
