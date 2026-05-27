import { describe, expect, it } from "vitest";
import {
  buildPathPrefixesSql,
  buildPathPrefixSql,
  escapeLikePattern,
} from "../src/sql-path-prefix.js";

describe("escapeLikePattern", () => {
  it("escapes %, _, and backslash so they can't act as LIKE metacharacters", () => {
    expect(escapeLikePattern("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });

  it("leaves ordinary characters alone", () => {
    expect(escapeLikePattern("/users/alice/")).toBe("/users/alice/");
  });
});

describe("buildPathPrefixSql", () => {
  it("emits one-param LIKE form when the prefix ends with '/'", () => {
    const { sql, params } = buildPathPrefixSql("d.path", "/docs/", 5);
    expect(sql).toBe("d.path LIKE $5 ESCAPE '\\'");
    expect(params).toEqual(["/docs/%"]);
  });

  it("emits exact-or-LIKE form with two params when the prefix lacks a trailing '/'", () => {
    const { sql, params } = buildPathPrefixSql("d.path", "/docs", 3);
    expect(sql).toBe("(d.path = $3 OR d.path LIKE $4 ESCAPE '\\')");
    expect(params).toEqual(["/docs", "/docs/%"]);
  });

  it("escapes wildcard characters inside the bound parameter", () => {
    const { sql, params } = buildPathPrefixSql("p", "/a%_b/", 1);
    expect(sql).toBe("p LIKE $1 ESCAPE '\\'");
    expect(params).toEqual(["/a\\%\\_b/%"]);
  });
});

describe("buildPathPrefixesSql", () => {
  it("returns an empty SQL fragment when given no prefixes", () => {
    const { sql, params } = buildPathPrefixesSql("p", [], 1);
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });

  it("OR-combines per-prefix subclauses and offsets parameter indexes", () => {
    const { sql, params } = buildPathPrefixesSql("d.path", ["/foo/", "/bar"], 2);
    expect(sql).toBe("(d.path LIKE $2 ESCAPE '\\' OR (d.path = $3 OR d.path LIKE $4 ESCAPE '\\'))");
    expect(params).toEqual(["/foo/%", "/bar", "/bar/%"]);
  });
});
