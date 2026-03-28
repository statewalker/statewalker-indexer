import { describe, expect, it } from "vitest";
import {
  type BlendTier,
  blendWithReranker,
  DEFAULT_BLEND_TIERS,
} from "../reranker-blend.js";
import type { SearchResult } from "../types.js";

describe("blendWithReranker", () => {
  // ---------------------------------------------------------------------------
  // Default tiers
  // ---------------------------------------------------------------------------
  describe("DEFAULT_BLEND_TIERS", () => {
    it("has three tiers: top-3, top-10, rest", () => {
      expect(DEFAULT_BLEND_TIERS).toEqual([
        { maxRank: 3, retrievalWeight: 0.75 },
        { maxRank: 10, retrievalWeight: 0.6 },
        { maxRank: Infinity, retrievalWeight: 0.4 },
      ]);
    });

    it("rank 1-3 use retrievalWeight 0.75", () => {
      const tier = DEFAULT_BLEND_TIERS.find((t) => t.maxRank >= 1);
      expect(tier?.retrievalWeight).toBe(0.75);
    });

    it("rank 4-10 use retrievalWeight 0.60", () => {
      const tier = DEFAULT_BLEND_TIERS.find((t) => t.maxRank >= 4);
      expect(tier?.maxRank).toBe(10);
      expect(tier?.retrievalWeight).toBe(0.6);
    });

    it("rank 11+ use retrievalWeight 0.40", () => {
      const tier = DEFAULT_BLEND_TIERS.find((t) => t.maxRank >= 11);
      expect(tier?.maxRank).toBe(Infinity);
      expect(tier?.retrievalWeight).toBe(0.4);
    });
  });

  // ---------------------------------------------------------------------------
  // Score calculation correctness
  // ---------------------------------------------------------------------------
  describe("score calculation", () => {
    it("computes blended score for rank 1 with default tiers", () => {
      const results: SearchResult[] = [{ blockId: "a", score: 0.9 }];
      const rerank = new Map([["a", 0.8]]);
      const blended = blendWithReranker(results, rerank);

      // rank=1, retrievalScore=1/1=1.0, weight=0.75
      // blended = 0.75 * 1.0 + 0.25 * 0.8 = 0.75 + 0.20 = 0.95
      expect(blended).toHaveLength(1);
      expect(blended[0]?.blockId).toBe("a");
      expect(blended[0]?.score).toBeCloseTo(0.95, 10);
    });

    it("computes blended score for rank 5 (tier 2)", () => {
      const results: SearchResult[] = Array.from({ length: 5 }, (_, i) => ({
        blockId: `item-${i}`,
        score: 0.9 - i * 0.1,
      }));
      const rerank = new Map([["item-4", 0.5]]);
      const blended = blendWithReranker(results, rerank);

      // item-4 is at rank 5, retrievalScore = 1/5 = 0.2, weight = 0.60
      // blended = 0.60 * 0.2 + 0.40 * 0.5 = 0.12 + 0.20 = 0.32
      const item4 = blended.find((r) => r.blockId === "item-4");
      expect(item4).toBeDefined();
      expect(item4?.score).toBeCloseTo(0.32, 10);
    });

    it("computes blended score for rank 15 (tier 3)", () => {
      const results: SearchResult[] = Array.from({ length: 15 }, (_, i) => ({
        blockId: `item-${i}`,
        score: 1 - i * 0.05,
      }));
      const rerank = new Map([["item-14", 0.6]]);
      const blended = blendWithReranker(results, rerank);

      // item-14 is at rank 15, retrievalScore = 1/15, weight = 0.40
      // blended = 0.40 * (1/15) + 0.60 * 0.6 = 0.02666... + 0.36 = 0.38666...
      const item14 = blended.find((r) => r.blockId === "item-14");
      expect(item14).toBeDefined();
      expect(item14?.score).toBeCloseTo(0.4 / 15 + 0.6 * 0.6, 10);
    });

    it("preserves collectionId in output", () => {
      const results: SearchResult[] = [
        { blockId: "a", score: 0.9, collectionId: "col1" },
      ];
      const rerank = new Map([["a", 0.5]]);
      const blended = blendWithReranker(results, rerank);
      expect(blended[0]?.collectionId).toBe("col1");
    });
  });

  // ---------------------------------------------------------------------------
  // Re-ordering
  // ---------------------------------------------------------------------------
  describe("re-ordering", () => {
    it("high reranker score can promote a low-ranked item", () => {
      const results: SearchResult[] = [
        { blockId: "top", score: 0.95 },
        { blockId: "mid", score: 0.8 },
        { blockId: "low", score: 0.6 },
      ];
      const rerank = new Map<string, number>([
        ["top", 0.1],
        ["mid", 0.1],
        ["low", 1.0],
      ]);
      const blended = blendWithReranker(results, rerank);

      // rank 1 (top): 0.75 * 1.0 + 0.25 * 0.1 = 0.775
      // rank 2 (mid): 0.75 * 0.5 + 0.25 * 0.1 = 0.400
      // rank 3 (low): 0.75 * (1/3) + 0.25 * 1.0 = 0.25 + 0.25 = 0.500
      // Order: top (0.775), low (0.500), mid (0.400)
      expect(blended[0]?.blockId).toBe("top");
      expect(blended[1]?.blockId).toBe("low");
      expect(blended[2]?.blockId).toBe("mid");
    });

    it("top items are protected by high retrieval weight", () => {
      const results: SearchResult[] = [
        { blockId: "first", score: 0.99 },
        { blockId: "second", score: 0.9 },
      ];
      const rerank = new Map<string, number>([
        ["first", 0.0],
        ["second", 1.0],
      ]);
      const blended = blendWithReranker(results, rerank);

      // rank 1 (first): 0.75 * 1.0 + 0.25 * 0.0 = 0.75
      // rank 2 (second): 0.75 * 0.5 + 0.25 * 1.0 = 0.375 + 0.25 = 0.625
      expect(blended[0]?.blockId).toBe("first");
      expect(blended[0]?.score).toBeCloseTo(0.75, 10);
      expect(blended[1]?.blockId).toBe("second");
      expect(blended[1]?.score).toBeCloseTo(0.625, 10);
    });

    it("results are sorted descending by blended score", () => {
      const results: SearchResult[] = Array.from({ length: 5 }, (_, i) => ({
        blockId: `r${i}`,
        score: 1 - i * 0.1,
      }));
      const rerank = new Map<string, number>([
        ["r0", 0.1],
        ["r1", 0.2],
        ["r2", 0.9],
        ["r3", 0.3],
        ["r4", 0.8],
      ]);
      const blended = blendWithReranker(results, rerank);

      for (let i = 1; i < blended.length; i++) {
        const prev = blended[i - 1];
        const curr = blended[i];
        expect(prev).toBeDefined();
        expect(curr).toBeDefined();
        if (prev && curr) {
          expect(prev.score).toBeGreaterThanOrEqual(curr.score);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Custom tiers
  // ---------------------------------------------------------------------------
  describe("custom tiers", () => {
    it("single tier applies to all ranks", () => {
      const tiers: BlendTier[] = [{ maxRank: Infinity, retrievalWeight: 0.5 }];
      const results: SearchResult[] = [
        { blockId: "a", score: 0.9 },
        { blockId: "b", score: 0.7 },
      ];
      const rerank = new Map([
        ["a", 0.4],
        ["b", 0.6],
      ]);
      const blended = blendWithReranker(results, rerank, tiers);

      // rank 1 (a): 0.5 * 1.0 + 0.5 * 0.4 = 0.7
      // rank 2 (b): 0.5 * 0.5 + 0.5 * 0.6 = 0.55
      expect(blended[0]?.blockId).toBe("a");
      expect(blended[0]?.score).toBeCloseTo(0.7, 10);
      expect(blended[1]?.blockId).toBe("b");
      expect(blended[1]?.score).toBeCloseTo(0.55, 10);
    });

    it("multiple custom tiers with different boundaries", () => {
      const tiers: BlendTier[] = [
        { maxRank: 1, retrievalWeight: 0.9 },
        { maxRank: 2, retrievalWeight: 0.1 },
        { maxRank: Infinity, retrievalWeight: 0.5 },
      ];
      const results: SearchResult[] = [
        { blockId: "a", score: 0.9 },
        { blockId: "b", score: 0.8 },
        { blockId: "c", score: 0.7 },
      ];
      const rerank = new Map([
        ["a", 0.5],
        ["b", 0.5],
        ["c", 0.5],
      ]);
      const blended = blendWithReranker(results, rerank, tiers);

      const a = blended.find((r) => r.blockId === "a");
      expect(a?.score).toBeCloseTo(0.95, 10);

      const b = blended.find((r) => r.blockId === "b");
      expect(b?.score).toBeCloseTo(0.5, 10);

      const c = blended.find((r) => r.blockId === "c");
      expect(c?.score).toBeCloseTo(1 / 6 + 0.25, 10);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe("edge cases", () => {
    it("returns empty array for empty results", () => {
      const blended = blendWithReranker([], new Map());
      expect(blended).toEqual([]);
    });

    it("handles single result", () => {
      const results: SearchResult[] = [{ blockId: "only", score: 0.5 }];
      const rerank = new Map([["only", 0.8]]);
      const blended = blendWithReranker(results, rerank);

      // rank=1, weight=0.75: 0.75 * 1.0 + 0.25 * 0.8 = 0.95
      expect(blended).toHaveLength(1);
      expect(blended[0]?.blockId).toBe("only");
      expect(blended[0]?.score).toBeCloseTo(0.95, 10);
    });

    it("missing reranker scores default to 0", () => {
      const results: SearchResult[] = [
        { blockId: "a", score: 0.9 },
        { blockId: "b", score: 0.8 },
      ];
      const rerank = new Map<string, number>();
      const blended = blendWithReranker(results, rerank);

      // rank 1 (a): 0.75 * 1.0 + 0.25 * 0.0 = 0.75
      // rank 2 (b): 0.75 * 0.5 + 0.25 * 0.0 = 0.375
      expect(blended[0]?.blockId).toBe("a");
      expect(blended[0]?.score).toBeCloseTo(0.75, 10);
      expect(blended[1]?.blockId).toBe("b");
      expect(blended[1]?.score).toBeCloseTo(0.375, 10);
    });

    it("identical reranker scores preserve original order", () => {
      const results: SearchResult[] = [
        { blockId: "a", score: 0.9 },
        { blockId: "b", score: 0.8 },
        { blockId: "c", score: 0.7 },
      ];
      const rerank = new Map([
        ["a", 0.5],
        ["b", 0.5],
        ["c", 0.5],
      ]);
      const blended = blendWithReranker(results, rerank);

      expect(blended[0]?.blockId).toBe("a");
      expect(blended[1]?.blockId).toBe("b");
      expect(blended[2]?.blockId).toBe("c");
    });

    it("does not mutate the input array", () => {
      const results: SearchResult[] = [
        { blockId: "a", score: 0.9 },
        { blockId: "b", score: 0.8 },
      ];
      const original = [...results];
      const rerank = new Map([
        ["a", 0.1],
        ["b", 0.9],
      ]);
      blendWithReranker(results, rerank);

      expect(results).toEqual(original);
    });
  });
});
