import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import type { Indexer } from "@statewalker/indexer-api";
import { createSqlIndexer } from "@statewalker/indexer-core";
import { pgliteDialect, wrapDbAsSqlDb } from "./dialect.js";

export interface PGLiteIndexerOptions {
  db?: PGlite;
}

/**
 * PGlite-backed `Indexer` over the open-registry contract.
 *
 * Wires the per-Index docs table, per-sub-index FTS / vector tables, and the
 * `__indexer_manifest` table via `createSqlIndexer`. Each Index is an open
 * registry of named sub-indexes; the FTS modality uses PostgreSQL `tsvector`
 * with GIN; the vector modality uses pgvector's `vector(dim)` with HNSW.
 */
export async function createPGLiteIndexer(options?: PGLiteIndexerOptions): Promise<Indexer> {
  const ownsDb = !options?.db;
  const db = options?.db ?? (await PGlite.create({ extensions: { vector } }));

  return createSqlIndexer({
    db: wrapDbAsSqlDb(db),
    dialect: pgliteDialect,
    onClose: ownsDb
      ? async () => {
          await db.close();
        }
      : undefined,
  });
}
