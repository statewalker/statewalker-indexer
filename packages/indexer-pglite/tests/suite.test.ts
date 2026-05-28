// =============================================================================
// PGLite Indexer conformance — wires through the kernel / RRF-blending /
// multi-instance conformance suites, plus SQL-specific scenarios inlined here
// because they're SQL-implementation-specific (docs-table reclamation,
// manifest survival across reopen, concurrent overwrite serialization).
//
// Per-modality FTS / vector conformance suites are Provider-based and don't
// fit SQL (retrievers need `db` + `docsTable` + `prefix`, not a typed
// `ModalityProvider.create(config)`). FTS + vector semantics are exercised
// indirectly through the Indexer-driven suites above.
// =============================================================================

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
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
import { createPGLiteIndexer } from "../src/pglite-indexer.js";

const factory = {
  create: () => createPGLiteIndexer(),
};

const ftConfig = { type: "fulltext" as const, language: "en" };
const vecConfig = { type: "vector" as const, dimensionality: 3, model: "test" };

runKernelConformanceSuite("PGLite Indexer", {
  factory,
  primaryConfig: ftConfig,
  secondaryConfig: vecConfig,
});

const ftAccess = newFullTextAccess("q");
runRrfBlendingSuite("PGLite FTS", {
  factory,
  config: ftConfig,
  populate: async (index: Index) => {
    const sub = ftAccess.get(index);
    await sub.addDocument([{ path: "/d/a", blockId: "a", content: "alpha alpha alpha" }]);
    await sub.addDocument([{ path: "/d/b", blockId: "b", content: "alpha beta" }]);
    await sub.addDocument([{ path: "/d/c", blockId: "c", content: "alpha gamma" }]);
  },
  buildQuery: ({ topK }) =>
    ({
      queries: ["alpha"],
      ...(topK !== undefined ? { topK } : {}),
    }) satisfies FulltextQuery,
});

runMultiInstanceConformanceSuite("PGLite Indexer", {
  factory,
  fullText: {
    configs: [
      () => ({ type: "fulltext", language: "en" }),
      () => ({ type: "fulltext", language: "fr" }),
    ],
    ingest: async (index, name, block) => {
      const access = newFullTextAccess(name);
      await access.get(index).addDocument([block]);
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
// SQL-specific scenarios.
// =============================================================================

describe("PGLite Indexer — docs-table reclamation", () => {
  let db: PGlite;
  let indexer: Awaited<ReturnType<typeof createPGLiteIndexer>>;

  beforeEach(async () => {
    db = await PGlite.create({ extensions: { vector } });
    indexer = await createPGLiteIndexer({ db });
  });

  afterEach(async () => {
    try {
      await indexer.close();
    } catch {
      /* may already be closed by the test */
    }
  });

  async function countDocsRows(indexName: string): Promise<number> {
    const prefix = sanitizePrefix(indexName);
    const { rows } = await db.query<{ cnt: number | bigint }>(
      `SELECT COUNT(*)::int AS cnt FROM idx_${prefix}_docs`,
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  it("FTS-only index: full deletion empties the docs table", async () => {
    const idx = await indexer.createIndex({
      name: "reclaim_fts",
      subIndexes: { q: ftConfig },
    });
    const fts = ftAccess.get(idx);
    await fts.addDocument([
      { path: "/d/1" as DocumentPath, blockId: "a", content: "hello" },
      { path: "/d/2" as DocumentPath, blockId: "b", content: "world" },
    ]);
    expect(await countDocsRows("reclaim_fts")).toBeGreaterThan(0);

    await idx.deleteDocuments([{ path: "/d/" as DocumentPath }]);
    expect(await countDocsRows("reclaim_fts")).toBe(0);
  });

  it("mixed index: removing the last reference frees the docs row", async () => {
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

    // Delete from one sub-index — doc row stays (vector still references it).
    await fts.deleteDocuments([{ path: "/d/1" as DocumentPath }]);
    // onAfterDelete didn't run (composite-level deleteDocuments wasn't called).
    // Instead, exercise the composite path:
    await idx.deleteDocuments([{ path: "/d/" as DocumentPath }]);
    expect(await countDocsRows("reclaim_mixed")).toBe(0);
  });
});

describe("PGLite Indexer — manifest survival across reopen", () => {
  it("createIndex + close + reopen via new Indexer instance preserves index list", async () => {
    const db = await PGlite.create({ extensions: { vector } });
    try {
      const indexer1 = await createPGLiteIndexer({ db });
      await indexer1.createIndex({ name: "persist", subIndexes: { q: ftConfig } });
      await indexer1.close();

      const indexer2 = await createPGLiteIndexer({ db });
      try {
        expect(await indexer2.hasIndex("persist")).toBe(true);
        const idx = await indexer2.getIndex("persist");
        expect(idx).not.toBeNull();
        expect(idx?.getBinding("q")?.type).toBe("fulltext");
        // The FTS table survived; ingest after reopen should work.
        const fts = newFullTextAccess("q").get(idx as Index);
        await fts.addDocument([
          { path: "/after" as DocumentPath, blockId: "b", content: "after-reopen" },
        ]);
        expect(await fts.getSize()).toBe(1);
      } finally {
        await indexer2.close();
      }
    } finally {
      await db.close();
    }
  });
});

describe("PGLite Indexer — concurrent createIndex overwrites are serialised", () => {
  it("Promise.all([createIndex(overwrite), createIndex(overwrite)]) leaves exactly one manifest row", async () => {
    const db = await PGlite.create({ extensions: { vector } });
    const indexer = await createPGLiteIndexer({ db });
    try {
      await indexer.createIndex({ name: "race", subIndexes: { q: ftConfig } });

      await Promise.all([
        indexer.createIndex({ name: "race", subIndexes: { q: ftConfig }, overwrite: true }),
        indexer.createIndex({ name: "race", subIndexes: { q: ftConfig }, overwrite: true }),
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
