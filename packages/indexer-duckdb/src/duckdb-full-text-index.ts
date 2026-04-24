import type { Db } from "@statewalker/db-api";
import type { FullTextIndex, FullTextIndexInfo } from "@statewalker/indexer-api";
import { createSqlFtsRetriever } from "@statewalker/indexer-core";
import { duckdbFtsDialect, wrapDbAsSqlDb } from "./dialect.js";

export type DuckDbFullTextIndex = FullTextIndex & {
  readonly tableName: string;
  init(): Promise<void>;
};

export function createDuckDbFullTextIndex(
  db: Db,
  prefix: string,
  docsTable: string,
  info: FullTextIndexInfo,
): DuckDbFullTextIndex {
  return createSqlFtsRetriever({
    db: wrapDbAsSqlDb(db),
    prefix,
    docsTable,
    info,
    dialect: duckdbFtsDialect,
  });
}
