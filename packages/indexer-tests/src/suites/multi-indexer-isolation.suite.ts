import type { Indexer } from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";
import { collect } from "./test-utils.js";

export function runMultiIndexerIsolationSuite(createIndexer: () => Promise<Indexer>): void {
  describe("Multi-Indexer Isolation", () => {
    // 30s timeout: PGlite WASM startup x2 alone takes ~12s on average.
    it("two indexers do not share state", { timeout: 30000 }, async () => {
      const a = await createIndexer();
      const b = await createIndexer();

      const indexA = await a.createIndex({
        name: "test",
        fulltext: { language: "en" },
      });
      await indexA.addDocument([{ path: "/test/1", blockId: "1", content: "only in A" }]);

      expect(await b.hasIndex("test")).toBe(false);

      await a.close();
      await b.close();
    });

    it("closing one indexer does not affect the other", { timeout: 30000 }, async () => {
      const a = await createIndexer();
      const b = await createIndexer();

      const indexB = await b.createIndex({
        name: "shared-name",
        fulltext: { language: "en" },
      });
      await indexB.addDocument([{ path: "/test/1", blockId: "1", content: "hello from B" }]);

      await a.close();

      const results = await collect(indexB.search({ queries: ["hello"], topK: 10 }));
      expect(results.length).toBeGreaterThan(0);

      await b.close();
    });
  });
}
