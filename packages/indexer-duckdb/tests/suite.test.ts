import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { newNodeDuckDb } from "@statewalker/db-duckdb-node";
import { createSqlBackedIndexer, type SqlDb, sanitizePrefix } from "@statewalker/indexer-core";
import {
  runCreateIndexAtomicitySuite,
  runDocsReclamationSuite,
  runIndexerTestSuite,
} from "@statewalker/indexer-tests";
import { duckdbDialect, wrapDbAsSqlDb } from "../src/dialect.js";
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

runDocsReclamationSuite("DuckDB Indexer", {
  async create() {
    const db = await newNodeDuckDb();
    const indexer = await createDuckDbIndexer({ db });
    return {
      indexer,
      async countDocsRows(indexName: string): Promise<number> {
        const prefix = sanitizePrefix(indexName);
        const rows = await db.query<{ cnt: number | bigint }>(
          `SELECT COUNT(*) AS cnt FROM idx_${prefix}_docs`,
        );
        return Number(rows[0]?.cnt ?? 0);
      },
      async cleanup() {
        await db.close();
      },
    };
  },
});

interface FailureInjection {
  matcher: (sql: string) => boolean;
  error: Error;
}

function injectingSqlDb(inner: SqlDb): SqlDb & {
  arm(injection: FailureInjection): void;
  disarm(): void;
} {
  let armed: FailureInjection | null = null;
  return {
    async exec(sql) {
      if (armed?.matcher(sql)) {
        const err = armed.error;
        armed = null;
        throw err;
      }
      await inner.exec(sql);
    },
    async query(sql, params) {
      if (armed?.matcher(sql)) {
        const err = armed.error;
        armed = null;
        throw err;
      }
      return inner.query(sql, params);
    },
    arm(injection) {
      armed = injection;
    },
    disarm() {
      armed = null;
    },
  };
}

runCreateIndexAtomicitySuite("DuckDB Indexer", {
  async create() {
    const db = await newNodeDuckDb();
    const wrapped = injectingSqlDb(wrapDbAsSqlDb(db));
    const indexer = await createSqlBackedIndexer({
      db: wrapped,
      dialect: duckdbDialect,
      onClose: async () => {
        await db.close();
      },
    });
    return {
      indexer,
      async hasManifestRow(name: string): Promise<boolean> {
        const rows = await db.query<{ cnt: number | bigint }>(
          "SELECT COUNT(*) AS cnt FROM __indexer_manifest WHERE name = $1",
          [name],
        );
        return Number(rows[0]?.cnt ?? 0) > 0;
      },
      async hasResidualTables(indexName: string): Promise<boolean> {
        const prefix = sanitizePrefix(indexName);
        const rows = await db.query<{ cnt: number | bigint }>(
          "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_name LIKE $1",
          [`idx_${prefix}_%`],
        );
        return Number(rows[0]?.cnt ?? 0) > 0;
      },
      injectFailureOnNext(matcher, error = new Error("injected failure")) {
        wrapped.arm({ matcher, error });
      },
      clearFailureInjection() {
        wrapped.disarm();
      },
      async cleanup() {
        // indexer.close() in afterEach already closes the underlying db.
      },
    };
  },
});
