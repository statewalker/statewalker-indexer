import { describe, expect, it } from "vitest";
import {
  getSubQuery,
  getSubResult,
  type SearchRequest,
  type SearchResult,
  setSubQuery,
  setSubResult,
} from "../src/index.js";

describe("name-parametric kernel helpers", () => {
  // --- Sub-query round-trip on SearchRequest --------------------------------

  it("getSubQuery returns undefined when the name is absent", () => {
    const req: SearchRequest = { topK: 10 };
    expect(getSubQuery(req, "q")).toBeUndefined();
  });

  it("setSubQuery / getSubQuery round-trip a value under a runtime name", () => {
    const req: SearchRequest = { topK: 10 };
    setSubQuery(req, "q_fr", { queries: ["bonjour"] });
    expect(getSubQuery(req, "q_fr")).toEqual({ queries: ["bonjour"] });
  });

  it("setSubQuery initialises req.subQueries when previously undefined", () => {
    const req: SearchRequest = { topK: 5 };
    expect(req.subQueries).toBeUndefined();
    setSubQuery(req, "q", { queries: ["x"] });
    expect(req.subQueries).toBeDefined();
    expect(req.subQueries?.q).toEqual({ queries: ["x"] });
  });

  it("distinct names do not collide on the same request", () => {
    const req: SearchRequest = { topK: 5 };
    setSubQuery(req, "q", { queries: ["a"] });
    setSubQuery(req, "q_fr", { queries: ["b"] });
    expect(getSubQuery(req, "q")).toEqual({ queries: ["a"] });
    expect(getSubQuery(req, "q_fr")).toEqual({ queries: ["b"] });
  });

  it("a sub-index name 'topK' does not overwrite the request's topK cutoff", () => {
    const req: SearchRequest = { topK: 10 };
    setSubQuery(req, "topK", { custom: "payload" });
    expect(req.topK).toBe(10);
    expect(req.subQueries?.topK).toEqual({ custom: "payload" });
  });

  // --- Sub-result round-trip on SearchResult --------------------------------

  it("getSubResult returns undefined when the name is absent", () => {
    const res: SearchResult = { path: "/d/a", blockId: "b1", score: 0.5 };
    expect(getSubResult(res, "q")).toBeUndefined();
  });

  it("setSubResult / getSubResult round-trip a hit under a runtime name", () => {
    const res: SearchResult = { path: "/d/a", blockId: "b1", score: 0.5 };
    setSubResult(res, "q", { path: "/d/a", blockId: "b1", score: 0.9, snippet: "snip" });
    expect(getSubResult<{ snippet: string }>(res, "q")?.snippet).toBe("snip");
  });

  it("reserved top-level fields (path, blockId, score) are never shadowed by a sub-result", () => {
    const res: SearchResult = { path: "/d/a", blockId: "b1", score: 0.5 };
    setSubResult(res, "score", { path: "/d/a", blockId: "b1", score: 0.99 });
    setSubResult(res, "path", { path: "/x", blockId: "y", score: 0.88 });
    expect(res.score).toBe(0.5);
    expect(res.path).toBe("/d/a");
    expect(res.subResults?.score).toBeDefined();
    expect(res.subResults?.path).toBeDefined();
  });
});
