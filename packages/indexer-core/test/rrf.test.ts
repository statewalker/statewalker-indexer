/**
 * Tests adapted from QMD (https://github.com/tobi/qmd) test/rrf-trace.test.ts
 * by Tobi Lutke. MIT License — Copyright (c) 2024-2026 Tobi Lutke.
 */
import { describe, expect, it } from "vitest";
import { buildRrfTrace, type RankedList, reciprocalRankFusion } from "../src/rrf.js";

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

// ---------------------------------------------------------------------------
// buildRrfTrace
// ---------------------------------------------------------------------------
describe("buildRrfTrace", () => {
  it("trace totals match fusion results exactly", () => {
    const lists = makeTwoLists();
    const merged = reciprocalRankFusion(lists, 10, K);
    const traces = buildRrfTrace(lists, K);

    for (const result of merged) {
      const trace = traces.get(result.blockId);
      expect(trace).toBeDefined();
      expect(trace?.totalScore).toBeCloseTo(result.score, 10);
    }
  });

  it("records per-list contributions with source metadata", () => {
    const lists = makeTwoLists();
    const traces = buildRrfTrace(lists, K);

    const traceA = traces.get("a");
    expect(traceA).toBeDefined();
    expect(traceA?.contributions).toHaveLength(2);

    const fromFts = traceA?.contributions.find((c) => c.source === "fts");
    expect(fromFts).toBeDefined();
    expect(fromFts?.listIndex).toBe(0);
    expect(fromFts?.rank).toBe(1); // 1-indexed
    expect(fromFts?.weight).toBe(2.0);
    expect(fromFts?.queryType).toBe("keyword");

    const fromVec = traceA?.contributions.find((c) => c.source === "vec");
    expect(fromVec).toBeDefined();
    expect(fromVec?.listIndex).toBe(1);
    expect(fromVec?.rank).toBe(2); // 1-indexed
    expect(fromVec?.weight).toBe(1.0);
    expect(fromVec?.queryType).toBe("semantic");
  });

  it("topRank is best rank across all lists", () => {
    const lists = makeTwoLists();
    const traces = buildRrfTrace(lists, K);

    // "a" is rank 1 in list 0, rank 2 in list 1 → topRank = 1
    expect(traces.get("a")?.topRank).toBe(1);
    // "b" is rank 2 in list 0, rank 1 in list 1 → topRank = 1
    expect(traces.get("b")?.topRank).toBe(1);
  });

  it("topRankBonus matches thresholds (0.05/0.02/0.0)", () => {
    const lists: RankedList[] = [
      {
        results: [
          { blockId: "rank1", score: 1 },
          { blockId: "rank2", score: 0.9 },
          { blockId: "rank3", score: 0.8 },
          { blockId: "rank4", score: 0.7 },
        ],
      },
    ];
    const traces = buildRrfTrace(lists, K);

    expect(traces.get("rank1")?.topRankBonus).toBe(0.05);
    expect(traces.get("rank2")?.topRankBonus).toBe(0.02);
    expect(traces.get("rank3")?.topRankBonus).toBe(0.02);
    expect(traces.get("rank4")?.topRankBonus).toBe(0);
  });

  it("contributions array has one entry per list appearance", () => {
    const lists: RankedList[] = [
      { results: [{ blockId: "doc", score: 1 }] },
      { results: [{ blockId: "doc", score: 1 }] },
      {
        results: [
          { blockId: "other", score: 1 },
          { blockId: "doc", score: 0.5 },
        ],
      },
    ];
    const traces = buildRrfTrace(lists, K);
    expect(traces.get("doc")?.contributions).toHaveLength(3);
    expect(traces.get("other")?.contributions).toHaveLength(1);
  });

  it("weighted contribution = weight / (k + rank + 1)", () => {
    const lists: RankedList[] = [
      {
        results: [{ blockId: "a", score: 1 }],
        weight: 3.0,
      },
    ];
    const traces = buildRrfTrace(lists, K);
    const contrib = traces.get("a")?.contributions[0];

    // rank 1 (1-indexed), so contribution = 3.0 / (60 + 1 + 1) = 3/62
    // Wait — rank is 1-indexed in trace, but formula uses 0-indexed position
    // contribution = weight / (k + 0-indexed-rank + 1) = 3 / (60 + 0 + 1) = 3/61
    expect(contrib?.contribution).toBeCloseTo(3 / 61, 10);
    expect(contrib?.rank).toBe(1);
    expect(contrib?.weight).toBe(3.0);
  });
});
