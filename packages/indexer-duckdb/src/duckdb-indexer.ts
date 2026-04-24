import type { Db } from "@statewalker/db-api";
import type { Indexer } from "@statewalker/indexer-api";
import { createSqlBackedIndexer } from "@statewalker/indexer-core";
import { duckdbDialect, wrapDbAsSqlDb } from "./dialect.js";

export interface DuckDbIndexerOptions {
  db: Db;
}

export function createDuckDbIndexer(options: DuckDbIndexerOptions): Promise<Indexer> {
  return createSqlBackedIndexer({
    db: wrapDbAsSqlDb(options.db),
    dialect: duckdbDialect,
  });
}
