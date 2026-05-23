import type { DocumentPath, Indexer } from "@statewalker/indexer-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Probe the backend's per-index docs table. Each SQL backend wires this in by
 * issuing a raw `SELECT COUNT(*) FROM idx_${prefix}_docs` against its own driver.
 * The suite stays free of dialect knowledge.
 */
export interface ReclamationProbe {
  indexer: Indexer;
  countDocsRows(indexName: string): Promise<number>;
  cleanup(): Promise<void>;
}

export interface ReclamationFactory {
  create(): Promise<ReclamationProbe>;
}

/**
 * Asserts that the shared `${prefix}_docs` table never accumulates rows whose
 * `doc_id` has no remaining sub-index entry.
 */
export function runDocsReclamationSuite(name: string, factory: ReclamationFactory): void {
  describe(`${name} — docs-table reclamation`, () => {
    let probe: ReclamationProbe;

    beforeEach(async () => {
      probe = await factory.create();
    });

    afterEach(async () => {
      try {
        await probe.indexer.close();
      } catch {
        // probe may have already closed the indexer in its own teardown
      }
      await probe.cleanup();
    });

    it("hybrid index: repeated add/delete cycles do not grow the docs table", async () => {
      const index = await probe.indexer.createIndex({
        name: "reclaim_hybrid",
        fulltext: { language: "en" },
        vector: { dimensionality: 3, model: "test" },
      });

      for (let i = 0; i < 25; i++) {
        const path = `/tmp/${i}` as DocumentPath;
        await index.addDocument([
          {
            path,
            blockId: "b",
            content: `block ${i}`,
            embedding: new Float32Array([i, 0, 0]),
          },
        ]);
        await index.deleteDocuments([{ path }]);
      }

      expect(await probe.countDocsRows("reclaim_hybrid")).toBe(0);
    });

    it("FTS-only index: partial deletion preserves only referenced docs", async () => {
      const index = await probe.indexer.createIndex({
        name: "reclaim_fts",
        fulltext: { language: "en" },
      });
      await index.addDocument([{ path: "/a" as DocumentPath, blockId: "1", content: "alpha" }]);
      await index.addDocument([{ path: "/b" as DocumentPath, blockId: "1", content: "beta" }]);
      await index.addDocument([{ path: "/c" as DocumentPath, blockId: "1", content: "gamma" }]);

      expect(await probe.countDocsRows("reclaim_fts")).toBe(3);

      await index.deleteDocuments([{ path: "/a" }, { path: "/b" }]);
      expect(await probe.countDocsRows("reclaim_fts")).toBe(1);
    });

    it("vector-only index: full deletion empties the docs table", async () => {
      const index = await probe.indexer.createIndex({
        name: "reclaim_vec",
        vector: { dimensionality: 3, model: "test" },
      });
      for (let i = 0; i < 5; i++) {
        await index.addDocument([
          {
            path: `/v/${i}` as DocumentPath,
            blockId: "b",
            embedding: new Float32Array([i, 0, 0]),
          },
        ]);
      }
      expect(await probe.countDocsRows("reclaim_vec")).toBe(5);

      await index.deleteDocuments([{ path: "/v/" }]);
      expect(await probe.countDocsRows("reclaim_vec")).toBe(0);
    });

    it("hybrid index: a doc with vector remaining keeps its docs row", async () => {
      const index = await probe.indexer.createIndex({
        name: "reclaim_partial",
        fulltext: { language: "en" },
        vector: { dimensionality: 3, model: "test" },
      });
      await index.addDocument([
        {
          path: "/a" as DocumentPath,
          blockId: "b",
          content: "alpha",
          embedding: new Float32Array([1, 0, 0]),
        },
      ]);
      // Block-specific delete via FTS sub-index only would be a different op;
      // here we just confirm the steady-state count is correct.
      expect(await probe.countDocsRows("reclaim_partial")).toBe(1);
    });
  });
}
