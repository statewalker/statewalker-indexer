import type { PGlite } from "@electric-sql/pglite";
import type { FullTextIndex, FullTextIndexInfo } from "@statewalker/indexer-api";
import { createSqlFtsRetriever } from "@statewalker/indexer-core";
import { pgliteFtsDialect, wrapDbAsSqlDb } from "./dialect.js";

export type PGLiteFullTextIndex = FullTextIndex & {
  readonly tableName: string;
  init(): Promise<void>;
};

export function createPGLiteFullTextIndex(
  db: PGlite,
  prefix: string,
  docsTable: string,
  info: FullTextIndexInfo,
): PGLiteFullTextIndex {
  return createSqlFtsRetriever({
    db: wrapDbAsSqlDb(db),
    prefix,
    docsTable,
    info,
    dialect: pgliteFtsDialect,
  });
}
