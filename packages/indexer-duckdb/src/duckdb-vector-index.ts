import type { Db } from "@statewalker/db-api";
import type { EmbeddingIndex, EmbeddingIndexInfo } from "@statewalker/indexer-api";
import { createSqlVectorRetriever } from "@statewalker/indexer-core";
import { duckdbVectorDialect, wrapDbAsSqlDb } from "./dialect.js";

export type DuckDbVectorIndex = EmbeddingIndex & {
  readonly tableName: string;
  init(): Promise<void>;
};

export function createDuckDbVectorIndex(
  db: Db,
  prefix: string,
  docsTable: string,
  info: EmbeddingIndexInfo,
): DuckDbVectorIndex {
  return createSqlVectorRetriever({
    db: wrapDbAsSqlDb(db),
    prefix,
    docsTable,
    info,
    dialect: duckdbVectorDialect,
  });
}
