import type { Indexer } from "@repo/indexer-api";
import { describe, expect, it } from "vitest";

export function runMultiIndexerIsolationSuite(
  createIndexer: () => Promise<Indexer>,
): void {
  describe("Multi-Indexer Isolation", () => {
    it("two independent indexers share no state", async () => {
      const indexer1 = await createIndexer();
      const indexer2 = await createIndexer();
      try {
        const idx1 = await indexer1.createIndex({
          name: "test",
          fulltext: { language: "en" },
        });
        await idx1.addDocument({ blockId: "a", content: "hello world" });

        // indexer2 should not see indexer1's index
        expect(await indexer2.hasIndex("test")).toBe(false);
        expect(await indexer2.getIndex("test")).toBeNull();
      } finally {
        await indexer1.close();
        await indexer2.close();
      }
    });

    it("closing one indexer does not affect another", async () => {
      const indexer1 = await createIndexer();
      const indexer2 = await createIndexer();
      try {
        await indexer2.createIndex({
          name: "survive",
          fulltext: { language: "en" },
        });

        await indexer1.close();

        // indexer2 still works after indexer1 closed
        expect(await indexer2.hasIndex("survive")).toBe(true);
        const idx = await indexer2.getIndex("survive");
        expect(idx).not.toBeNull();
      } finally {
        try {
          await indexer1.close();
        } catch {
          // may already be closed
        }
        await indexer2.close();
      }
    });
  });
}
