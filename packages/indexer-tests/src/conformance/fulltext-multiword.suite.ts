// =============================================================================
// Multi-word full-text conformance — Indexer-driven, backend-agnostic.
//
// Pins ONE cross-backend contract: a single query string carrying several terms
// is NOT a strict all-terms AND. Sections covering only part of the term set are
// returned (partial match), and a section covering more of the term set ranks
// above one covering less. This is the behaviour every FTS backend must share —
// FlexSearch (`suggest`), MiniSearch (OR default), and the SQL backends (PGlite
// `to_tsquery … | …`, DuckDB `match_bm25` OR default).
//
// Unlike `runFullTextConformanceSuite` (Provider-based, mem-only), this drives
// the composite `Index` so it fits the SQL retrievers too, which expose FTS only
// through the Indexer, not as a standalone `ModalityProvider`.
// =============================================================================

import type { DocumentPath, Index, SearchRequest } from "@statewalker/indexer-api";
import { newFullTextAccess } from "@statewalker/indexer-fulltext";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collect } from "./test-utils.js";
import type { IndexerFactory } from "./types.js";

export interface FullTextMultiWordSuiteOptions {
  factory: IndexerFactory;
  /** A complete full-text sub-index config the backend accepts (registered as `"q"`). */
  config: { type: string } & Record<string, unknown>;
}

export function runFullTextMultiWordSuite(
  name: string,
  options: FullTextMultiWordSuiteOptions,
): void {
  const { factory, config } = options;
  const access = newFullTextAccess("q");

  describe(`${name} — multi-word FTS`, () => {
    let indexer: Awaited<ReturnType<typeof factory.create>>;
    let index: Index;

    beforeEach(async () => {
      indexer = await factory.create();
      index = await indexer.createIndex({ name: "mw-test", subIndexes: { q: config } });
      await access.get(index).addDocument([
        { path: "/d/all" as DocumentPath, blockId: "all", content: "alpha beta gamma" },
        { path: "/d/two" as DocumentPath, blockId: "two", content: "alpha beta" },
        { path: "/d/one" as DocumentPath, blockId: "one", content: "alpha" },
      ]);
      await indexer.flush();
    });

    afterEach(async () => {
      try {
        await indexer.close();
      } catch {
        /* */
      }
      await factory.cleanup?.();
    });

    it("a multi-word query returns partial-coverage sections, best coverage first", async () => {
      const request: SearchRequest = {
        topK: 10,
        subQueries: { q: { queries: ["alpha beta gamma"] } },
      };
      const hits = await collect(index.search(request));
      const ids = hits.map((h) => h.blockId);
      // Not a strict AND: the single-term section is still retrieved.
      expect(ids).toContain("one");
      // Coverage matters: the all-terms section outranks the single-term one.
      const rankAll = ids.indexOf("all");
      const rankOne = ids.indexOf("one");
      expect(rankAll).toBeGreaterThanOrEqual(0);
      expect(rankAll).toBeLessThan(rankOne);
    });
  });
}
