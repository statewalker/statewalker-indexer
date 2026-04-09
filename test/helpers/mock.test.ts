import { describe, expect, it } from "vitest";
import {
  createMockCitationBuilder,
  createMockExpander,
  createMockReranker,
} from "../../src/helpers/mock.js";

describe("createMockExpander", () => {
  it("returns deterministic lex expansion for any query", async () => {
    const expander = createMockExpander();
    const results = await expander("test query");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.type).toBe("lex");
    expect(results[0]?.query).toBe("test query");
  });

  it("respects maxVariations option", async () => {
    const expander = createMockExpander();
    const results1 = await expander("test", { maxVariations: 1 });
    expect(results1.length).toBe(1);

    const results2 = await expander("test", { maxVariations: 2 });
    expect(results2.length).toBe(2);
    expect(results2[1]?.type).toBe("vec");
  });

  it("includes hyde when intent provided and maxVariations >= 3", async () => {
    const expander = createMockExpander();
    const results = await expander("test", {
      intent: "debugging",
      maxVariations: 3,
    });
    expect(results.length).toBe(3);
    expect(results[2]?.type).toBe("hyde");
    expect(results[2]?.query).toContain("debugging");
  });
});

describe("createMockReranker", () => {
  it("returns deterministic scores for known blockIds", async () => {
    const scoreMap = new Map([
      ["b1", 0.9],
      ["b2", 0.5],
    ]);
    const reranker = createMockReranker(scoreMap);
    const results = await reranker("query", [
      { blockId: "b1", text: "doc1" },
      { blockId: "b2", text: "doc2" },
    ]);
    expect(results[0]?.blockId).toBe("b1");
    expect(results[0]?.score).toBe(0.9);
    expect(results[1]?.blockId).toBe("b2");
    expect(results[1]?.score).toBe(0.5);
  });

  it("scores are in [0, 1] range for position-based fallback", async () => {
    const reranker = createMockReranker();
    const results = await reranker("query", [
      { blockId: "a", text: "doc" },
      { blockId: "b", text: "doc" },
      { blockId: "c", text: "doc" },
    ]);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it("respects topK limit", async () => {
    const reranker = createMockReranker();
    const results = await reranker(
      "query",
      [
        { blockId: "a", text: "doc" },
        { blockId: "b", text: "doc" },
        { blockId: "c", text: "doc" },
      ],
      { topK: 1 },
    );
    expect(results.length).toBe(1);
  });
});

describe("createMockCitationBuilder", () => {
  it("returns citations for top results", async () => {
    const builder = createMockCitationBuilder();
    const citations = await builder(
      "test query",
      [
        { blockId: "b1", score: 0.9 },
        { blockId: "b2", score: 0.5 },
      ],
      async (blockId) => `Content for ${blockId}`,
    );
    expect(citations.length).toBe(2);
    expect(citations[0]?.blockId).toBe("b1");
    expect(citations[0]?.snippet).toContain("Content for b1");
    expect(citations[0]?.context).toContain("test query");
  });

  it("respects maxCitations option", async () => {
    const builder = createMockCitationBuilder();
    const citations = await builder(
      "query",
      [
        { blockId: "a", score: 1 },
        { blockId: "b", score: 0.5 },
        { blockId: "c", score: 0.3 },
      ],
      async (id) => id,
      { maxCitations: 1 },
    );
    expect(citations.length).toBe(1);
  });
});
