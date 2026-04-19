import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { newNodeDuckDb } from "@statewalker/db-duckdb-node";
import { runIndexerTestSuite } from "@statewalker/indexer-tests";
import { createDuckDbIndexer } from "../src/duckdb-indexer.js";

const TEST_DB_DIR = join(fileURLToPath(new URL(".", import.meta.url)), ".testdb");

runIndexerTestSuite("DuckDB Indexer - on disk", {
  async create() {
    // Clean and recreate test db directory
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true });
    }
    mkdirSync(TEST_DB_DIR, { recursive: true });

    const dbPath = join(TEST_DB_DIR, "test.duckdb");
    const db = await newNodeDuckDb({ path: dbPath });
    return createDuckDbIndexer({ db });
  },
  async cleanup() {
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true });
    }
  },
});

runIndexerTestSuite("DuckDB Indexer - in memory", {
  async create() {
    const db = await newNodeDuckDb();
    return createDuckDbIndexer({ db });
  },
  async cleanup() {},
});
