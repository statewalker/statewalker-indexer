import type { PGlite } from "@electric-sql/pglite";
import type { EmbeddingIndex, EmbeddingIndexInfo } from "@statewalker/indexer-api";
import { createSqlVectorRetriever } from "@statewalker/indexer-core";
import { pgliteVectorDialect, wrapDbAsSqlDb } from "./dialect.js";

export type PGLiteVectorIndex = EmbeddingIndex & {
  readonly tableName: string;
  init(): Promise<void>;
};

export function createPGLiteVectorIndex(
  db: PGlite,
  prefix: string,
  docsTable: string,
  info: EmbeddingIndexInfo,
): PGLiteVectorIndex {
  return createSqlVectorRetriever({
    db: wrapDbAsSqlDb(db),
    prefix,
    docsTable,
    info,
    dialect: pgliteVectorDialect,
  });
}
