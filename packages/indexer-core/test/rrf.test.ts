/**
 * Tests adapted from QMD (https://github.com/tobi/qmd) test/rrf-trace.test.ts
 * by Tobi Lutke. MIT License — Copyright (c) 2024-2026 Tobi Lutke.
 */
import { describe, expect, it } from "vitest";
import { type RankedList, reciprocalRankFusion } from "../src/rrf.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const K = 60;

/** Two overlapping lists with weights [2.0, 1.0]. */
function makeTwoLists(): RankedList[] {
  return [
    {
      results: [
        { blockId: "a", score: 0.9 },
        { blockId: "b", score: 0.7 },
      ],
      weight: 2.0,
      meta: { source: "fts", queryType: "keyword", query: "hello" },
    },
    {
      results: [
        { blockId: "b", score: 0.8 },
        { blockId: "a", score: 0.6 },
      ],
      weight: 1.0,
      meta: { source: "vec", queryType: "semantic", query: "hello" },
    },
  ];
}

// ---------------------------------------------------------------------------
// reciprocalRankFusion
// ---------------------------------------------------------------------------
describe("reciprocalRankFusion", () => {
  it("merges two unweighted lists correctly", () => {
    const lists: RankedList[] = [
      { results: [{ blockId: "x", score: 1 }] },
      { results: [{ blockId: "y", score: 1 }] },
    ];
    const merged = reciprocalRankFusion(lists, 10, K);

    // Both at rank 0, weight 1.0 → base = 1/(60+0+1) = 1/61
    // Both rank 1 (1-indexed) → +0.05 bonus
    const expected = 1 / 61 + 0.05;
    expect(merged).toHaveLength(2);
    expect(merged[0]?.score).toBeCloseTo(expected, 10);
    expect(merged[1]?.score).toBeCloseTo(expected, 10);
  });

  it("weighted lists — higher weight contributes more", () => {
    const lists = makeTwoLists();
    const merged = reciprocalRankFusion(lists, 10, K);

    // "a": 2/(61) + 1/(62) + bonus(rank1) = 2/61 + 1/62 + 0.05
    // "b": 2/(62) + 1/(61) + bonus(rank1) = 2/62 + 1/61 + 0.05
    const scoreA = 2 / 61 + 1 / 62 + 0.05;
    const scoreB = 2 / 62 + 1 / 61 + 0.05;

    expect(merged).toHaveLength(2);
    // "a" should be first (slightly higher)
    expect(merged[0]?.blockId).toBe("a");
    expect(merged[0]?.score).toBeCloseTo(scoreA, 10);
    expect(merged[1]?.blockId).toBe("b");
    expect(merged[1]?.score).toBeCloseTo(scoreB, 10);
  });

  it("document in multiple lists gets combined score", () => {
    const lists: RankedList[] = [
      { results: [{ blockId: "shared", score: 1 }], weight: 1.0 },
      { results: [{ blockId: "shared", score: 1 }], weight: 1.0 },
      { results: [{ blockId: "shared", score: 1 }], weight: 1.0 },
    ];
    const merged = reciprocalRankFusion(lists, 10, K);

    // 3 * 1/(61) + rank1 bonus 0.05
    const expected = 3 / 61 + 0.05;
    expect(merged).toHaveLength(1);
    expect(merged[0]?.blockId).toBe("shared");
    expect(merged[0]?.score).toBeCloseTo(expected, 10);
  });

  it("topK limits output count", () => {
    const lists: RankedList[] = [
      {
        results: [
          { blockId: "a", score: 1 },
          { blockId: "b", score: 0.9 },
          { blockId: "c", score: 0.8 },
        ],
      },
    ];
    const merged = reciprocalRankFusion(lists, 2, K);
    expect(merged).toHaveLength(2);
  });

  it("empty lists return empty", () => {
    expect(reciprocalRankFusion([], 10, K)).toEqual([]);
    expect(reciprocalRankFusion([{ results: [] }, { results: [] }], 10, K)).toEqual([]);
  });

  it("single list returns RRF-scored items", () => {
    const lists: RankedList[] = [
      {
        results: [
          { blockId: "a", score: 1 },
          { blockId: "b", score: 0.5 },
        ],
        weight: 1.0,
      },
    ];
    const merged = reciprocalRankFusion(lists, 10, K);

    // "a": 1/61 + 0.05 (rank 1 bonus)
    // "b": 1/62 + 0.02 (rank 2 bonus)
    expect(merged).toHaveLength(2);
    expect(merged[0]?.blockId).toBe("a");
    expect(merged[0]?.score).toBeCloseTo(1 / 61 + 0.05, 10);
    expect(merged[1]?.blockId).toBe("b");
    expect(merged[1]?.score).toBeCloseTo(1 / 62 + 0.02, 10);
  });
});

// ---------------------------------------------------------------------------
// reciprocalRankFusion — top-rank bonus
// ---------------------------------------------------------------------------
describe("reciprocalRankFusion — top-rank bonus", () => {
  it("rank 1 in any list gets +0.05 bonus", () => {
    const lists: RankedList[] = [{ results: [{ blockId: "first", score: 1 }] }];
    const merged = reciprocalRankFusion(lists, 10, K);
    // base = 1/61, bonus = 0.05
    expect(merged[0]?.score).toBeCloseTo(1 / 61 + 0.05, 10);
  });

  it("rank 2-3 gets +0.02 bonus", () => {
    const lists: RankedList[] = [
      {
        results: [
          { blockId: "r1", score: 1 },
          { blockId: "r2", score: 0.9 },
          { blockId: "r3", score: 0.8 },
        ],
      },
    ];
    const merged = reciprocalRankFusion(lists, 10, K);
    const r2 = merged.find((r) => r.blockId === "r2");
    const r3 = merged.find((r) => r.blockId === "r3");
    expect(r2?.score).toBeCloseTo(1 / 62 + 0.02, 10);
    expect(r3?.score).toBeCloseTo(1 / 63 + 0.02, 10);
  });

  it("rank 4+ gets no bonus", () => {
    const lists: RankedList[] = [
      {
        results: [
          { blockId: "r1", score: 1 },
          { blockId: "r2", score: 0.9 },
          { blockId: "r3", score: 0.8 },
          { blockId: "r4", score: 0.7 },
          { blockId: "r5", score: 0.6 },
        ],
      },
    ];
    const merged = reciprocalRankFusion(lists, 10, K);
    const r4 = merged.find((r) => r.blockId === "r4");
    const r5 = merged.find((r) => r.blockId === "r5");
    expect(r4?.score).toBeCloseTo(1 / 64, 10);
    expect(r5?.score).toBeCloseTo(1 / 65, 10);
  });

  it("bonus uses best rank across all lists", () => {
    // "item" is rank 3 in list 1, rank 1 in list 2 → best rank is 1 → +0.05
    const lists: RankedList[] = [
      {
        results: [
          { blockId: "x", score: 1 },
          { blockId: "y", score: 0.9 },
          { blockId: "item", score: 0.8 },
        ],
      },
      { results: [{ blockId: "item", score: 1 }] },
    ];
    const merged = reciprocalRankFusion(lists, 10, K);
    const item = merged.find((r) => r.blockId === "item");

    // base = 1/63 (list1 rank3) + 1/61 (list2 rank1)
    // bonus = 0.05 (best rank = 1)
    expect(item?.score).toBeCloseTo(1 / 63 + 1 / 61 + 0.05, 10);
  });
});
