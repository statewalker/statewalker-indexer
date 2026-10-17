// =============================================================================
// N-gram (grep) conformance — Indexer-driven, backend-agnostic.
//
// Pins the NgramIndex contract: exact literal and regex matches with UTF-16
// offsets and 1-based lines, case sensitivity (default sensitive), score =
// match count, path scoping, deletion, replacement, no match across blocks,
// patterns too short for an n-gram, and the RRF path through Index.search.
// =============================================================================

import type { DocumentPath, Index } from "@statewalker/indexer-api";
import { grep, newNgramAccess } from "@statewalker/indexer-ngram";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collect } from "./test-utils.js";
import type { IndexerFactory } from "./types.js";

export interface NgramSuiteOptions {
  factory: IndexerFactory;
  /** A complete n-gram sub-index config (registered as `"g"`). */
  config: { type: string } & Record<string, unknown>;
}

const A = "function fooBar() {\n  return fooBar;\n}\n";
const B = "const FOOBAR = 1;\n";
const C = "no match here\nfoo  bar\n";

export function runNgramConformanceSuite(name: string, options: NgramSuiteOptions): void {
  const { factory, config } = options;
  const access = newNgramAccess("g");

  describe(`${name} — n-gram conformance`, () => {
    let indexer: Awaited<ReturnType<typeof factory.create>>;
    let index: Index;

    beforeEach(async () => {
      indexer = await factory.create();
      index = await indexer.createIndex({ name: "ng-test", subIndexes: { g: config } });
      const sub = access.get(index);
      await sub.addDocument([{ path: "/src/a.ts" as DocumentPath, blockId: "a", content: A }]);
      await sub.addDocument([{ path: "/src/b.ts" as DocumentPath, blockId: "b", content: B }]);
      await sub.addDocument([{ path: "/docs/c.md" as DocumentPath, blockId: "c", content: C }]);
      await indexer.flush();
    });

    afterEach(async () => {
      await indexer.close().catch(() => undefined);
      await factory.cleanup?.();
    });

    it("finds a literal with offsets, lines and score = count", async () => {
      const second = A.indexOf("fooBar", 15);
      const { hits, truncated } = await grep(index, "g", "fooBar");
      expect(truncated).toBe(false);
      expect(hits).toEqual([
        {
          path: "/src/a.ts",
          blockId: "a",
          score: 2,
          count: 2,
          matches: [
            { start: 9, end: 15, line: 1 },
            { start: second, end: second + 6, line: 2 },
          ],
        },
      ]);
    });

    it("is case-sensitive by default and folds case on request, ranking by count", async () => {
      expect((await grep(index, "g", "foobar")).hits).toEqual([]);
      const { hits } = await grep(index, "g", "foobar", { caseSensitive: false });
      expect(hits.map((h) => [h.blockId, h.count])).toEqual([
        ["a", 2],
        ["b", 1],
      ]);
    });

    it("reads regex metacharacters literally unless regex: true", async () => {
      expect((await grep(index, "g", "fooBar()")).hits.map((h) => h.count)).toEqual([1]);
      const { hits } = await grep(index, "g", "foo\\s+bar", { regex: true });
      expect(hits.map((h) => [h.blockId, h.matches[0]?.line])).toEqual([["c", 2]]);
    });

    it("finds patterns shorter than an n-gram", async () => {
      expect((await grep(index, "g", "()")).hits.map((h) => h.blockId)).toEqual(["a"]);
    });

    it("scopes by path prefix", async () => {
      const { hits } = await grep(index, "g", "foo", {
        caseSensitive: false,
        paths: ["/src" as DocumentPath],
      });
      expect(hits.map((h) => h.blockId).sort()).toEqual(["a", "b"]);
    });

    it("never matches across two blocks of one document", async () => {
      await access.get(index).addDocument([
        { path: "/split" as DocumentPath, blockId: "1", content: "xyzab" },
        { path: "/split" as DocumentPath, blockId: "2", content: "cdxyz" },
      ]);
      expect((await grep(index, "g", "abcd")).hits).toEqual([]);
    });

    it("deleteDocuments and re-adding a block are reflected", async () => {
      const sub = access.get(index);
      await sub.deleteDocuments([{ path: "/src/a.ts" as DocumentPath }]);
      expect((await grep(index, "g", "fooBar")).hits).toEqual([]);
      await sub.addDocument([
        { path: "/docs/c.md" as DocumentPath, blockId: "c", content: "fooBar once" },
      ]);
      expect((await grep(index, "g", "foo  bar", {})).hits).toEqual([]);
      expect((await grep(index, "g", "fooBar")).hits.map((h) => h.blockId)).toEqual(["c"]);
      expect(await sub.getSize()).toBe(2);
    });

    it("joins Index.search through its sub-query, with the n-gram hit as sub-result", async () => {
      const results = await collect(
        index.search({ topK: 5, subQueries: { g: { pattern: "fooBar" } } }),
      );
      expect(results.map((r) => r.blockId)).toEqual(["a"]);
      expect(access.getResult(results[0] as (typeof results)[number])?.count).toBe(2);
    });
  });
}
