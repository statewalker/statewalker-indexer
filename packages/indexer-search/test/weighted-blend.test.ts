import { type SearchResult, setSubResult } from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";
import { weightedBlend } from "../src/weighted-blend.js";

// Tiny native-result shape used by the tests — only `score` matters for blending.
interface NativeHit {
  path: string;
  blockId: string;
  score: number;
}

function makeResult(path: string, blockId: string, rrfScore: number): SearchResult {
  return {
    path: path as `/${string}`,
    blockId,
    score: rrfScore,
  };
}

function attachSub(result: SearchResult, name: string, score: number): SearchResult {
  setSubResult<NativeHit>(result, name, { path: result.path, blockId: result.blockId, score });
  return result;
}

describe("weightedBlend", () => {
  it("reorders by weighted blend of per-name normalised native scores", () => {
    // Two sub-indexes, "q" (fts) and "semantic" (vector).
    // Native scores chosen so that under weights {q: 0.7, semantic: 0.3}
    // doc A wins despite B having the higher fusion score going in.
    const a = attachSub(makeResult("/d1", "a", 0.5), "q", 10);
    attachSub(a, "semantic", 0);
    const b = attachSub(makeResult("/d2", "b", 0.9), "q", 0);
    attachSub(b, "semantic", 10);

    const blended = weightedBlend([a, b], { q: 0.7, semantic: 0.3 });

    expect(blended.map((r) => r.blockId)).toEqual(["a", "b"]);
    expect(blended[0]?.score).toBeGreaterThan(blended[1]?.score ?? Infinity);
  });

  it("uses min-max normalisation per sub-index name", () => {
    // Three docs; "q" scores 30/20/10, "semantic" scores 0/5/10.
    // With equal weights {q:0.5, semantic:0.5} the middle doc wins:
    //   q-norm = (1.0, 0.5, 0.0); sem-norm = (0.0, 0.5, 1.0)
    //   blended = 0.5, 0.5, 0.5 — tied. Tie-breaker is original order.
    // Adjust weights to break the tie deterministically.
    const docs: SearchResult[] = [
      attachSub(attachSub(makeResult("/d", "a", 0), "q", 30), "semantic", 0),
      attachSub(attachSub(makeResult("/d", "b", 0), "q", 20), "semantic", 5),
      attachSub(attachSub(makeResult("/d", "c", 0), "q", 10), "semantic", 10),
    ];

    const blended = weightedBlend(docs, { q: 0.6, semantic: 0.4 });
    // q-weight 0.6 dominates → "a" wins.
    expect(blended[0]?.blockId).toBe("a");
  });

  it("treats a missing sub-result as score 0 for that name", () => {
    const a = attachSub(makeResult("/d1", "a", 0.5), "q", 10);
    // doc b only has "semantic" — no "q" sub-result.
    const b = attachSub(makeResult("/d2", "b", 0.5), "semantic", 10);
    const blended = weightedBlend([a, b], { q: 1.0, semantic: 0.0 });
    expect(blended[0]?.blockId).toBe("a");
    expect(blended[1]?.blockId).toBe("b");
  });

  it("respects topK by truncating after sort", () => {
    const docs: SearchResult[] = [
      attachSub(makeResult("/d", "a", 0), "q", 10),
      attachSub(makeResult("/d", "b", 0), "q", 5),
      attachSub(makeResult("/d", "c", 0), "q", 1),
    ];
    const blended = weightedBlend(docs, { q: 1.0 }, { topK: 2 });
    expect(blended.length).toBe(2);
    expect(blended.map((r) => r.blockId)).toEqual(["a", "b"]);
  });

  it("falls back to 1/(i+1) when every native score is equal (range = 0)", () => {
    // All q-scores are 7 → range 0 → normalisation falls back to position decay.
    const docs: SearchResult[] = [
      attachSub(makeResult("/d", "a", 0), "q", 7),
      attachSub(makeResult("/d", "b", 0), "q", 7),
      attachSub(makeResult("/d", "c", 0), "q", 7),
    ];
    const blended = weightedBlend(docs, { q: 1.0 });
    // Original order preserved because each rank-decay score is unique.
    expect(blended.map((r) => r.blockId)).toEqual(["a", "b", "c"]);
  });
});
