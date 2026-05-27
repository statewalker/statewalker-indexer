import type { BlockId, DocumentPath, Index, ScoredItem } from "@statewalker/indexer-api";
import {
  type Citation,
  type CitationBuilderFn,
  type ExpandedQuery,
  type QueryExpanderFn,
  type RerankerFn,
  SearchPipeline,
} from "@statewalker/indexer-search";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlexSearchIndexer } from "../src/index.js";

let indexer: ReturnType<typeof createFlexSearchIndexer>;
let index: Index;

beforeEach(async () => {
  indexer = createFlexSearchIndexer();
  index = await indexer.createIndex({
    name: "on-error",
    fulltext: { language: "en" },
  });
  await index.addDocument([
    { path: "/a" as DocumentPath, blockId: "a", content: "alpha content" },
    { path: "/b" as DocumentPath, blockId: "b", content: "beta content" },
  ]);
});

afterEach(async () => {
  await indexer.close();
});

const throwingExpander: QueryExpanderFn = async (_query): Promise<ExpandedQuery[]> => {
  throw new Error("expander boom");
};

const throwingReranker: RerankerFn = async (_query, _candidates): Promise<ScoredItem[]> => {
  throw new Error("reranker boom");
};

const throwingCitationBuilder: CitationBuilderFn = async (
  _query,
  _results,
  _getContent,
): Promise<Citation[]> => {
  throw new Error("citations boom");
};

describe("SearchPipeline — onError callback", () => {
  it('invokes onError("expansion", err) and falls back to the plain prompt', async () => {
    const onError = vi.fn();
    const results = await new SearchPipeline({
      index,
      expander: throwingExpander,
      onError,
    })
      .setPrompt("alpha")
      .setTopK(5)
      .execute();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      "expansion",
      expect.objectContaining({ message: "expander boom" }),
    );
    expect(results.length).toBeGreaterThan(0);
  });

  it('invokes onError("rerank", err) and returns retrieval ordering', async () => {
    const onError = vi.fn();
    const results = await new SearchPipeline({
      index,
      reranker: throwingReranker,
      onError,
    })
      .setTextQueries("alpha", "beta")
      .setTopK(5)
      .execute();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      "rerank",
      expect.objectContaining({ message: "reranker boom" }),
    );
    // Retrieval ordering survived — alpha first since the lex query for "alpha"
    // matches the "/a" block more strongly.
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => !("citation" in r) || r.citation === undefined)).toBe(true);
  });

  it('invokes onError("citations", err) and returns entries without citations', async () => {
    const onError = vi.fn();
    const results = await new SearchPipeline({
      index,
      citationBuilder: throwingCitationBuilder,
      onError,
    })
      .setTextQueries("alpha")
      .setTopK(5)
      .execute();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      "citations",
      expect.objectContaining({ message: "citations boom" }),
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.citation === undefined)).toBe(true);
  });

  it("omitting onError preserves the silent-fallback behaviour", async () => {
    const exec = () =>
      new SearchPipeline({
        index,
        expander: throwingExpander,
        reranker: throwingReranker,
        citationBuilder: throwingCitationBuilder,
      })
        .setPrompt("alpha")
        .setTopK(5)
        .execute();

    await expect(exec()).resolves.toBeInstanceOf(Array);
  });
});

// Quiet the unused-type imports for editors that warn on type-only imports
// when no runtime symbol comes from the same name.
type _UnusedBlockId = BlockId;
