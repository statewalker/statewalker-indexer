import type { DocumentPath } from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";
import { matchesPrefix } from "../src/path-prefix.js";

const p = (s: string): DocumentPath => s as DocumentPath;

describe("matchesPrefix", () => {
  it("matches an exact path", () => {
    expect(matchesPrefix(p("/foo"), p("/foo"))).toBe(true);
  });

  it("matches when prefix ends with a separator", () => {
    expect(matchesPrefix(p("/foo/bar"), p("/foo/"))).toBe(true);
    expect(matchesPrefix(p("/foo/bar/baz"), p("/foo/"))).toBe(true);
  });

  it("matches a child path when prefix has no trailing slash", () => {
    expect(matchesPrefix(p("/foo/bar"), p("/foo"))).toBe(true);
  });

  it("does NOT match a sibling that merely shares a prefix string", () => {
    expect(matchesPrefix(p("/foobar"), p("/foo"))).toBe(false);
    expect(matchesPrefix(p("/users/alice2"), p("/users/alice"))).toBe(false);
    expect(matchesPrefix(p("/foo-deleted"), p("/foo"))).toBe(false);
  });

  it("matches the root prefix universally", () => {
    expect(matchesPrefix(p("/anything"), p("/"))).toBe(true);
    expect(matchesPrefix(p("/"), p("/"))).toBe(true);
  });
});
