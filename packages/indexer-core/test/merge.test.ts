import type {
  DocumentPath,
  EmbeddingSearchResult,
  FullTextSearchResult,
} from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";
import { mergeByRRF } from "../src/merge.js";

const path = "/docs/" as DocumentPath;

function fts(blockId: string, score: number, snippet = ""): FullTextSearchResult {
  return { path, blockId, score, snippet };
}

function vec(blockId: string, score: number): EmbeddingSearchResult {
  return { path, blockId, score };
}

describe("mergeByRRF top-rank bonus", () => {
  it("boosts a block ranked #1 in both lists over a block tied at rank #5", () => {
    const ftsResults = [
      fts("top", 0.99),
      fts("f2", 0.8),
      fts("f3", 0.7),
      fts("f4", 0.6),
      fts("mid", 0.5),
    ];
    const vecResults = [
      vec("top", 0.99),
      vec("v2", 0.8),
      vec("v3", 0.7),
      vec("v4", 0.6),
      vec("mid", 0.5),
    ];

    const merged = mergeByRRF(ftsResults, vecResults, 10);
    const top = merged.find((r) => r.blockId === "top");
    const mid = merged.find((r) => r.blockId === "mid");
    expect(top).toBeDefined();
    expect(mid).toBeDefined();

    // Top-rank bonus (0.05 at rank 1) is applied per-block, not per-list.
    // The rank-1 block enjoys the +0.05 boost; the rank-5 block does not.
    const boost = (top?.score ?? 0) - (mid?.score ?? 0);
    const baseDiff = 2 * (1 / (60 + 1) - 1 / (60 + 5)); // diff in pure RRF contributions
    expect(boost).toBeGreaterThan(baseDiff + 0.04);
  });
});
