// =============================================================================
// DuckDB Indexer conformance — wires through the kernel / RRF-blending /
// multi-instance conformance suites, plus SQL-specific scenarios inlined
// here (docs-table reclamation, manifest survival across reopen, concurrent
// overwrite serialization).
//
// Per-modality FTS / vector conformance suites are Provider-based and don't
// fit SQL; FTS + vector semantics are exercised through the Indexer-driven
// suites instead.
// =============================================================================

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { newNodeDuckDb } from "@statewalker/db-duckdb-node";
import type { DocumentPath, Index } from "@statewalker/indexer-api";
import { sanitizePrefix } from "@statewalker/indexer-core";
import type { FulltextQuery } from "@statewalker/indexer-fulltext";
import { newFullTextAccess } from "@statewalker/indexer-fulltext";
import {
  runKernelConformanceSuite,
  runMultiInstanceConformanceSuite,
  runRrfBlendingSuite,
} from "@statewalker/indexer-tests";
import type { VectorQuery } from "@statewalker/indexer-vector";
import { newVectorAccess } from "@statewalker/indexer-vector";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDuckDbIndexer } from "../src/duckdb-indexer.js";

const TEST_DB_DIR = join(fileURLToPath(new URL(".", import.meta.url)), ".testdb");

const inMemFactory = {
  create: async () => {
    const db = await newNodeDuckDb();
    return createDuckDbIndexer({ db });
  },
};

const ftConfig = { type: "fulltext" as const, language: "en" };
const vecConfig = { type: "vector" as const, dimensionality: 3, model: "test" };

runKernelConformanceSuite("DuckDB Indexer - in memory", {
  factory: inMemFactory,
  primaryConfig: ftConfig,
  secondaryConfig: vecConfig,
});

const ftAccess = newFullTextAccess("q");
runRrfBlendingSuite("DuckDB FTS", {
  factory: inMemFactory,
  config: ftConfig,
  populate: async (index: Index) => {
    const sub = ftAccess.get(index);
    await sub.addDocument([{ path: "/d/a", blockId: "a", content: "alpha alpha alpha" }]);
    await sub.addDocument([{ path: "/d/b", blockId: "b", content: "alpha beta" }]);
    await sub.addDocument([{ path: "/d/c", blockId: "c", content: "alpha gamma" }]);
    await index.flush();
  },
  buildQuery: ({ topK }) =>
    ({
      queries: ["alpha"],
      ...(topK !== undefined ? { topK } : {}),
    }) satisfies FulltextQuery,
});

runMultiInstanceConformanceSuite("DuckDB Indexer", {
  factory: inMemFactory,
  fullText: {
    configs: [
      () => ({ type: "fulltext", language: "en" }),
      () => ({ type: "fulltext", language: "fr" }),
    ],
    ingest: async (index, name, block) => {
      const access = newFullTextAccess(name);
      await access.get(index).addDocument([block]);
      await index.flush();
    },
    buildQuery: (query: string) => ({ queries: [query] }) satisfies FulltextQuery,
  },
  vector: {
    configs: [
      () => ({ type: "vector", dimensionality: 3, model: "model-a" }),
      () => ({ type: "vector", dimensionality: 3, model: "model-b" }),
    ],
    ingest: async (index, name, block) => {
      const access = newVectorAccess(name);
      await access.get(index).addDocument([block]);
    },
    buildQuery: (embedding: Float32Array) => ({ embeddings: [embedding] }) satisfies VectorQuery,
  },
});

// =============================================================================
// DuckDB on-disk basic round-trip.
// =============================================================================

describe("DuckDB Indexer - on disk", () => {
  beforeEach(() => {
    if (existsSync(TEST_DB_DIR)) rmSync(TEST_DB_DIR, { recursive: true });
    mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DB_DIR)) rmSync(TEST_DB_DIR, { recursive: true });
  });

  it("createIndex + addDocument + search round-trip on disk", async () => {
    const dbPath = join(TEST_DB_DIR, "test.duckdb");
    const db = await newNodeDuckDb({ path: dbPath });
    const indexer = await createDuckDbIndexer({ db });
    try {
      const idx = await indexer.createIndex({
        name: "ondisk",
        subIndexes: { q: ftConfig },
      });
      const fts = newFullTextAccess("q").get(idx);
      await fts.addDocument([{ path: "/d/1" as DocumentPath, blockId: "a", content: "hello" }]);
      await idx.flush();
      expect(await fts.getSize()).toBe(1);
    } finally {
      await indexer.close();
    }
  });
});

// =============================================================================
// SQL-specific scenarios.
// =============================================================================

describe("DuckDB Indexer — docs-table reclamation", () => {
  let db: Awaited<ReturnType<typeof newNodeDuckDb>>;
  let indexer: Awaited<ReturnType<typeof createDuckDbIndexer>>;

  beforeEach(async () => {
    db = await newNodeDuckDb();
    indexer = await createDuckDbIndexer({ db });
  });

  afterEach(async () => {
    try {
      await indexer.close();
    } catch {
      /* */
    }
  });

  async function countDocsRows(indexName: string): Promise<number> {
    const prefix = sanitizePrefix(indexName);
    const rows = await db.query<{ cnt: number | bigint }>(
      `SELECT COUNT(*) AS cnt FROM idx_${prefix}_docs`,
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  it("FTS-only index: full deletion empties the docs table", async () => {
    const idx = await indexer.createIndex({
      name: "reclaim_fts",
      subIndexes: { q: ftConfig },
    });
    const fts = newFullTextAccess("q").get(idx);
    await fts.addDocument([
      { path: "/d/1" as DocumentPath, blockId: "a", content: "hello" },
      { path: "/d/2" as DocumentPath, blockId: "b", content: "world" },
    ]);
    expect(await countDocsRows("reclaim_fts")).toBeGreaterThan(0);

    await idx.deleteDocuments([{ path: "/d/" as DocumentPath }]);
    expect(await countDocsRows("reclaim_fts")).toBe(0);
  });

  it("mixed index: composite deleteDocuments reclaims orphans across FTS + vector", async () => {
    const idx = await indexer.createIndex({
      name: "reclaim_mixed",
      subIndexes: { q: ftConfig, v: vecConfig },
    });
    const fts = newFullTextAccess("q").get(idx);
    const vec = newVectorAccess("v").get(idx);
    await fts.addDocument([{ path: "/d/1" as DocumentPath, blockId: "a", content: "x" }]);
    await vec.addDocument([
      { path: "/d/1" as DocumentPath, blockId: "a", embedding: new Float32Array([1, 0, 0]) },
    ]);
    expect(await countDocsRows("reclaim_mixed")).toBeGreaterThan(0);

    await idx.deleteDocuments([{ path: "/d/" as DocumentPath }]);
    expect(await countDocsRows("reclaim_mixed")).toBe(0);
  });
});

describe("DuckDB Indexer — manifest survival across reopen", () => {
  it("createIndex + close + reopen via new Indexer instance preserves index list", async () => {
    const dbPath = join(TEST_DB_DIR, "manifest.duckdb");
    if (existsSync(TEST_DB_DIR)) rmSync(TEST_DB_DIR, { recursive: true });
    mkdirSync(TEST_DB_DIR, { recursive: true });
    try {
      {
        const db = await newNodeDuckDb({ path: dbPath });
        const indexer1 = await createDuckDbIndexer({ db });
        await indexer1.createIndex({ name: "persist", subIndexes: { q: ftConfig } });
        await indexer1.flush();
        await indexer1.close();
      }
      {
        const db = await newNodeDuckDb({ path: dbPath });
        const indexer2 = await createDuckDbIndexer({ db });
        try {
          expect(await indexer2.hasIndex("persist")).toBe(true);
          const idx = await indexer2.getIndex("persist");
          expect(idx).not.toBeNull();
          expect(idx?.getBinding("q")?.type).toBe("fulltext");
          const fts = newFullTextAccess("q").get(idx as Index);
          await fts.addDocument([
            { path: "/after" as DocumentPath, blockId: "b", content: "after-reopen" },
          ]);
          expect(await fts.getSize()).toBe(1);
        } finally {
          await indexer2.close();
        }
      }
    } finally {
      if (existsSync(TEST_DB_DIR)) rmSync(TEST_DB_DIR, { recursive: true });
    }
  });
});

describe("DuckDB Indexer — concurrent createIndex overwrites are serialised", () => {
  it("Promise.all([createIndex(overwrite), createIndex(overwrite)]) leaves exactly one manifest row", async () => {
    const db = await newNodeDuckDb();
    const indexer = await createDuckDbIndexer({ db });
    try {
      await indexer.createIndex({ name: "race", subIndexes: { q: ftConfig } });

      await Promise.all([
        indexer.createIndex({ name: "race", subIndexes: { q: ftConfig }, overwrite: true }),
        indexer.createIndex({ name: "race", subIndexes: { q: ftConfig }, overwrite: true }),
      ]);

      const rows = await db.query<{ cnt: number | bigint }>(
        "SELECT COUNT(*) AS cnt FROM __indexer_manifest WHERE name = $1",
        ["race"],
      );
      expect(Number(rows[0]?.cnt ?? 0)).toBe(1);
      expect(await indexer.hasIndex("race")).toBe(true);
    } finally {
      await indexer.close();
    }
  });
});
