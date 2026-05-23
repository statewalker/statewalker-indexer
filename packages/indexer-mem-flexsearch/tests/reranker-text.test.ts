import type { DocumentPath, Index } from "@statewalker/indexer-api";
import { SearchPipeline } from "@statewalker/indexer-search";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFlexSearchIndexer } from "../src/index.js";

let indexer: ReturnType<typeof createFlexSearchIndexer>;
let index: Index;

beforeEach(async () => {
  indexer = createFlexSearchIndexer();
  index = await indexer.createIndex({
    name: "rerank-text",
    fulltext: { language: "en" },
  });
  await index.addDocument([
    { path: "/x" as DocumentPath, blockId: "b-alpha", content: "alpha content" },
    { path: "/y" as DocumentPath, blockId: "b-beta", content: "beta content" },
    { path: "/z" as DocumentPath, blockId: "b-gamma", content: "gamma content" },
  ]);
});

afterEach(async () => {
  await indexer.close();
});

describe("SearchPipeline — reranker candidate text", () => {
  it("passes block content to the reranker, not the blockId", async () => {
    const seen: Array<{ blockId: string; text: string }> = [];
    const reranker = async (
      _query: string,
      candidates: Array<{ blockId: string; text: string }>,
    ) => {
      for (const c of candidates) seen.push({ blockId: c.blockId, text: c.text });
      return candidates.map((c, i) => ({ blockId: c.blockId, score: 1 / (i + 1) }));
    };

    await new SearchPipeline({ index, reranker })
      .setTextQueries("alpha", "beta", "gamma")
      .setTopK(3)
      .execute();

    expect(seen.length).toBeGreaterThan(0);
    // The reranker must NOT be handed the blockId as the text payload.
    for (const c of seen) {
      expect(c.text).not.toBe(c.blockId);
    }
    // It should receive the actual content stored in the index.
    const texts = seen.map((s) => s.text);
    expect(texts).toEqual(expect.arrayContaining(["alpha content"]));
  });
});
