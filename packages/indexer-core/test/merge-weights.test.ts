import type { DocumentPath, FullTextSearchResult } from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";
import { mergeByWeights } from "../src/merge.js";

const path = "/docs/" as DocumentPath;

function fts(blockId: string, score: number): FullTextSearchResult {
  return { path, blockId, score, snippet: "" };
}

describe("mergeByWeights — degenerate normalisation", () => {
  it("preserves original ordering when every input score is equal", () => {
    // All FTS scores tied: the original retrieval order should win.
    const ftsResults = [fts("a", 1), fts("b", 1), fts("c", 1), fts("d", 1)];
    const merged = mergeByWeights(ftsResults, [], { fts: 1, embedding: 0 }, 10);
    const ids = merged.map((r) => r.blockId);
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });

  it("doesn't collapse every tied entry onto the same normalised score", () => {
    // When normalisation degenerates (range = 0), assigning 1.0 to every
    // entry erases all ranking information — the resulting blend can return
    // results in any order. Each entry must instead get a distinct score.
    const ftsResults = [fts("a", 0.5), fts("b", 0.5), fts("c", 0.5)];
    const merged = mergeByWeights(ftsResults, [], { fts: 1, embedding: 0 }, 10);
    const scores = merged.map((r) => r.score);
    expect(new Set(scores).size).toBe(scores.length);
  });
});
