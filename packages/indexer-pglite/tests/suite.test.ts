import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import type { DocumentPath } from "@statewalker/indexer-api";
import { createSqlBackedIndexer, type SqlDb, sanitizePrefix } from "@statewalker/indexer-core";
import {
  runCreateIndexAtomicitySuite,
  runDocsReclamationSuite,
  runIndexerTestSuite,
} from "@statewalker/indexer-tests";
import { describe, expect, it } from "vitest";
import { pgliteDialect, wrapDbAsSqlDb } from "../src/dialect.js";
import { createPGLiteIndexer } from "../src/pglite-indexer.js";

runIndexerTestSuite("PGLite Indexer", {
  create: () => createPGLiteIndexer(),
});

runDocsReclamationSuite("PGLite Indexer", {
  async create() {
    const db = await PGlite.create({ extensions: { vector } });
    const indexer = await createPGLiteIndexer({ db });
    return {
      indexer,
      async countDocsRows(indexName: string): Promise<number> {
        const prefix = sanitizePrefix(indexName);
        const { rows } = await db.query<{ cnt: number | bigint }>(
          `SELECT COUNT(*)::int AS cnt FROM idx_${prefix}_docs`,
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

runCreateIndexAtomicitySuite("PGLite Indexer", {
  async create() {
    const db = await PGlite.create({ extensions: { vector } });
    const wrapped = injectingSqlDb(wrapDbAsSqlDb(db));
    const indexer = await createSqlBackedIndexer({
      db: wrapped,
      dialect: pgliteDialect,
      onClose: async () => {
        await db.close();
      },
    });
    return {
      indexer,
      async hasManifestRow(name: string): Promise<boolean> {
        const { rows } = await db.query<{ cnt: number | bigint }>(
          "SELECT COUNT(*)::int AS cnt FROM __indexer_manifest WHERE name = $1",
          [name],
        );
        return Number(rows[0]?.cnt ?? 0) > 0;
      },
      async hasResidualTables(indexName: string): Promise<boolean> {
        const prefix = sanitizePrefix(indexName);
        const { rows } = await db.query<{ cnt: number | bigint }>(
          "SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name LIKE $1",
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

describe("PGLite Indexer — getIndex restore re-initialises sub-index tables", () => {
  it("recreates an FTS table dropped out-of-band when getIndex is called", async () => {
    const db = await PGlite.create({ extensions: { vector } });
    const indexer = await createPGLiteIndexer({ db });
    try {
      const idx = await indexer.createIndex({
        name: "restore_fts",
        fulltext: { language: "en" },
      });
      await idx.addDocument([
        { path: "/before" as DocumentPath, blockId: "b", content: "before-drop" },
      ]);

      // Force the indexer to re-build the retrievers from the manifest on the
      // next getIndex call by closing it and rebuilding against the same DB.
      await indexer.close();

      // Drop the FTS table out-of-band to simulate state drift.
      const prefix = sanitizePrefix("restore_fts");
      await db.exec(`DROP TABLE IF EXISTS idx_${prefix}_fts`);

      const reopened = await createPGLiteIndexer({ db });
      try {
        const restored = await reopened.getIndex("restore_fts");
        expect(restored).not.toBeNull();
        // init() ran during getIndex, so the table exists again — addDocument succeeds.
        await restored?.addDocument([
          { path: "/after" as DocumentPath, blockId: "b", content: "after-restore" },
        ]);
        const fts = restored?.getFullTextIndex();
        expect(await fts?.getSize()).toBe(1);
      } finally {
        await reopened.close();
      }
    } finally {
      await db.close();
    }
  });
});

describe("PGLite Indexer — concurrent createIndex overwrites are serialised", () => {
  it("Promise.all([createIndex, createIndex]) leaves exactly one manifest row", async () => {
    const db = await PGlite.create({ extensions: { vector } });
    const indexer = await createPGLiteIndexer({ db });
    try {
      // Seed an index so both calls hit the overwrite branch.
      await indexer.createIndex({ name: "race", fulltext: { language: "en" } });

      await Promise.all([
        indexer.createIndex({ name: "race", fulltext: { language: "en" }, overwrite: true }),
        indexer.createIndex({ name: "race", fulltext: { language: "en" }, overwrite: true }),
      ]);

      const { rows } = await db.query<{ cnt: number | bigint }>(
        "SELECT COUNT(*)::int AS cnt FROM __indexer_manifest WHERE name = $1",
        ["race"],
      );
      expect(Number(rows[0]?.cnt ?? 0)).toBe(1);
      expect(await indexer.hasIndex("race")).toBe(true);
    } finally {
      await indexer.close();
      await db.close();
    }
  });
});
