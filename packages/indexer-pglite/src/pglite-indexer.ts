import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import type { Indexer } from "@statewalker/indexer-api";
import { createSqlBackedIndexer } from "@statewalker/indexer-core";
import { pgliteDialect, wrapDbAsSqlDb } from "./dialect.js";

export interface PGLiteIndexerOptions {
  db?: PGlite;
}

export async function createPGLiteIndexer(options?: PGLiteIndexerOptions): Promise<Indexer> {
  const ownsDb = !options?.db;
  const db = options?.db ?? (await PGlite.create({ extensions: { vector } }));

  return createSqlBackedIndexer({
    db: wrapDbAsSqlDb(db),
    dialect: pgliteDialect,
    onClose: ownsDb
      ? async () => {
          await db.close();
        }
      : undefined,
  });
}
