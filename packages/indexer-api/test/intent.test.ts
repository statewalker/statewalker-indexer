/**
 * Tests adapted from QMD (https://github.com/tobi/qmd) test/intent.test.ts
 * by Tobi Lutke. MIT License — Copyright (c) 2024-2026 Tobi Lutke.
 */
import { describe, expect, it } from "vitest";
import { extractIntentTerms, selectBestChunk } from "../src/intent.js";

describe("extractIntentTerms", () => {
  it("filters common stop words (the, a, is, of, in, to, and, for, with, on, at, by, an, or)", () => {
    const result = extractIntentTerms(
      "the quick fox is a friend of an old dog in to and for with on at by or",
    );
    expect(result).toEqual(["quick", "fox", "friend", "old", "dog"]);
  });

  it("preserves domain terms (API, SQL, CI/CD, HTTP, REST)", () => {
    const result = extractIntentTerms("API SQL CI/CD HTTP REST");
    expect(result).toEqual(["api", "sql", "ci/cd", "http", "rest"]);
  });

  it("lowercases all output terms", () => {
    const result = extractIntentTerms("Hello World FOO Bar");
    expect(result).toEqual(["hello", "world", "foo", "bar"]);
  });

  it("returns empty for empty string", () => {
    expect(extractIntentTerms("")).toEqual([]);
  });

  it("returns empty for stop-words-only input", () => {
    expect(extractIntentTerms("the a is of in to and for")).toEqual([]);
  });

  it("splits on whitespace and punctuation", () => {
    const result = extractIntentTerms("hello,world;foo:bar!baz?qux");
    expect(result).toEqual(["hello", "world", "foo", "bar", "baz", "qux"]);
  });

  it("deduplicates terms", () => {
    const result = extractIntentTerms("hello hello world world hello");
    expect(result).toEqual(["hello", "world"]);
  });
});

describe("selectBestChunk", () => {
  it("selects chunk with most query term overlap", () => {
    const chunks = [
      "Database indexing improves query speed.",
      "REST API design patterns for web services.",
      "Machine learning models require training data.",
    ];
    const result = selectBestChunk(chunks, ["api", "web", "rest"]);
    expect(result?.index).toBe(1);
    expect(result?.chunk).toBe(chunks[1]);
  });

  it("intent terms break ties between equally-matching chunks", () => {
    const chunks = [
      "Python is great for data science projects.",
      "Python is great for web development projects.",
    ];
    // Both match "python" equally; intent "web" breaks the tie
    const result = selectBestChunk(chunks, ["python"], ["web", "server"]);
    expect(result?.index).toBe(1);
  });

  it("intent weight 0.5 means intent terms worth half a query term", () => {
    const chunks = ["Alpha beta gamma delta.", "Alpha epsilon zeta."];
    // Chunk 0: query matches alpha (1) + intent matches beta (0.5), gamma (0.5) = 2.0
    // Chunk 1: query matches alpha (1) + intent matches epsilon (0.5) = 1.5
    const result = selectBestChunk(chunks, ["alpha"], ["beta", "gamma", "epsilon"], 0.5);
    expect(result?.index).toBe(0);
    expect(result?.score).toBe(2.0);
  });

  it("without intent terms, falls back to pure query matching", () => {
    const chunks = ["Cats are fluffy animals.", "Dogs are loyal companions."];
    const result = selectBestChunk(chunks, ["dogs", "loyal"]);
    expect(result?.index).toBe(1);
    expect(result?.score).toBe(2);
  });

  it("returns first chunk when all score equally", () => {
    const chunks = ["aaa", "bbb", "ccc"];
    const result = selectBestChunk(chunks, ["zzz"]);
    expect(result?.index).toBe(0);
  });

  it("handles empty chunks array — returns undefined", () => {
    const result = selectBestChunk([], ["query"]);
    expect(result).toBeUndefined();
  });

  it("handles empty query terms — uses intent terms only", () => {
    const chunks = ["Frontend React components.", "Backend Node.js server."];
    const result = selectBestChunk(chunks, [], ["backend", "server"]);
    expect(result?.index).toBe(1);
  });

  it("multi-meaning word resolved by intent context", () => {
    const chunks = [
      "Web application performance can be improved by caching and CDN usage.",
      "Team performance reviews happen quarterly with manager feedback.",
      "Health performance metrics track heart rate and recovery time.",
    ];
    const result = selectBestChunk(chunks, ["performance"], ["web", "application", "speed"]);
    expect(result?.index).toBe(0);
  });
});
