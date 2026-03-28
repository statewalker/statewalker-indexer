import { describe, expect, it } from "vitest";
import {
  isCollectionPrefix,
  matchesCollection,
  resolveCollections,
} from "../collection-filter.js";

describe("isCollectionPrefix", () => {
  it("returns true for strings ending with /", () => {
    expect(isCollectionPrefix("docs/")).toBe(true);
    expect(isCollectionPrefix("a/b/c/")).toBe(true);
    expect(isCollectionPrefix("/")).toBe(true);
  });

  it("returns false for strings not ending with /", () => {
    expect(isCollectionPrefix("docs")).toBe(false);
    expect(isCollectionPrefix("")).toBe(false);
    expect(isCollectionPrefix("docs/api")).toBe(false);
  });
});

describe("matchesCollection", () => {
  it("matches exact collectionId", () => {
    expect(matchesCollection("docs", "docs")).toBe(true);
    expect(matchesCollection("a/b/c", "a/b/c")).toBe(true);
  });

  it("does not match different exact string", () => {
    expect(matchesCollection("docs", "images")).toBe(false);
    expect(matchesCollection("docs", "doc")).toBe(false);
  });

  it("matches prefix filter (ending with /)", () => {
    expect(matchesCollection("docs/api", "docs/")).toBe(true);
    expect(matchesCollection("docs/api/v2", "docs/")).toBe(true);
    expect(matchesCollection("docs", "docs/")).toBe(false);
  });

  it("matches root prefix /", () => {
    expect(matchesCollection("anything", "/")).toBe(false);
    expect(matchesCollection("/foo", "/")).toBe(true);
  });

  it("handles edge cases", () => {
    expect(matchesCollection("", "")).toBe(true);
    expect(matchesCollection("", "a/")).toBe(false);
    expect(matchesCollection("a/", "a/")).toBe(true);
  });
});

describe("resolveCollections", () => {
  const allCollections = [
    "docs/api",
    "docs/guides",
    "docs/tutorials",
    "images/photos",
    "images/icons",
    "videos",
    "_default",
  ];

  it("returns exact match for a single string filter", () => {
    expect(resolveCollections("videos", allCollections)).toEqual(["videos"]);
  });

  it("returns empty array when single string does not match", () => {
    expect(resolveCollections("nonexistent", allCollections)).toEqual([]);
  });

  it("returns prefix matches for a single prefix filter", () => {
    expect(resolveCollections("docs/", allCollections)).toEqual([
      "docs/api",
      "docs/guides",
      "docs/tutorials",
    ]);
  });

  it("returns matches for an array of exact IDs", () => {
    expect(resolveCollections(["videos", "_default"], allCollections)).toEqual([
      "videos",
      "_default",
    ]);
  });

  it("returns matches for an array of mixed exact and prefix filters", () => {
    expect(resolveCollections(["images/", "videos"], allCollections)).toEqual([
      "images/photos",
      "images/icons",
      "videos",
    ]);
  });

  it("returns empty array for empty string filter with no empty collection", () => {
    expect(resolveCollections("", allCollections)).toEqual([]);
  });

  it("returns empty array for empty array filter", () => {
    expect(resolveCollections([], allCollections)).toEqual([]);
  });

  it("handles overlapping prefixes without duplicates", () => {
    const result = resolveCollections(["docs/", "docs/api"], allCollections);
    expect(result).toEqual(["docs/api", "docs/guides", "docs/tutorials"]);
  });

  it("root prefix / matches all collections starting with /", () => {
    const collections = ["/a", "/b/c", "plain", "/"];
    expect(resolveCollections("/", collections)).toEqual(["/a", "/b/c", "/"]);
  });

  it("preserves order of allCollections", () => {
    const result = resolveCollections(["_default", "docs/"], allCollections);
    expect(result).toEqual([
      "docs/api",
      "docs/guides",
      "docs/tutorials",
      "_default",
    ]);
  });
});
