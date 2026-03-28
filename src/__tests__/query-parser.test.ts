/**
 * Tests adapted from QMD (https://github.com/tobi/qmd) test/structured-search.test.ts
 * by Tobi Lutke. MIT License — Copyright (c) 2024-2026 Tobi Lutke.
 */
import { describe, expect, it } from "vitest";
import {
  parseStructuredQuery,
  validateLexQuery,
  validateSemanticQuery,
} from "../query-parser.js";

describe("parseStructuredQuery", () => {
  describe("plain queries — returns null", () => {
    it("single line without prefix returns null", () => {
      expect(parseStructuredQuery("how does CAP theorem work")).toBeNull();
    });

    it("explicit expand: returns null", () => {
      expect(parseStructuredQuery("expand: CAP theorem")).toBeNull();
    });

    it("empty/whitespace returns null", () => {
      expect(parseStructuredQuery("")).toBeNull();
      expect(parseStructuredQuery("   ")).toBeNull();
      expect(parseStructuredQuery("\n\n")).toBeNull();
    });
  });

  describe("single prefixed queries", () => {
    it("lex: prefix", () => {
      expect(parseStructuredQuery("lex: CAP theorem")).toEqual([
        { type: "lex", query: "CAP theorem", line: 1 },
      ]);
    });

    it("vec: prefix", () => {
      expect(parseStructuredQuery("vec: distributed consensus")).toEqual([
        { type: "vec", query: "distributed consensus", line: 1 },
      ]);
    });

    it("hyde: prefix", () => {
      expect(parseStructuredQuery("hyde: explain raft algorithm")).toEqual([
        { type: "hyde", query: "explain raft algorithm", line: 1 },
      ]);
    });

    it("case-insensitive (LEX:, Lex:, VeC:)", () => {
      expect(parseStructuredQuery("LEX: term one")).toEqual([
        { type: "lex", query: "term one", line: 1 },
      ]);
      expect(parseStructuredQuery("Lex: term two")).toEqual([
        { type: "lex", query: "term two", line: 1 },
      ]);
      expect(parseStructuredQuery("VeC: term three")).toEqual([
        { type: "vec", query: "term three", line: 1 },
      ]);
    });
  });

  describe("multiple prefixed queries", () => {
    it("lex + vec on separate lines", () => {
      expect(parseStructuredQuery("lex: CAP theorem\nvec: consensus")).toEqual([
        { type: "lex", query: "CAP theorem", line: 1 },
        { type: "vec", query: "consensus", line: 2 },
      ]);
    });

    it("all three types", () => {
      const input = "lex: keyword\nvec: semantic search\nhyde: hypothetical";
      expect(parseStructuredQuery(input)).toEqual([
        { type: "lex", query: "keyword", line: 1 },
        { type: "vec", query: "semantic search", line: 2 },
        { type: "hyde", query: "hypothetical", line: 3 },
      ]);
    });

    it("duplicate types allowed", () => {
      expect(parseStructuredQuery("lex: one\nlex: two")).toEqual([
        { type: "lex", query: "one", line: 1 },
        { type: "lex", query: "two", line: 2 },
      ]);
    });

    it("order preserved", () => {
      const input = "hyde: first\nlex: second\nvec: third";
      const result = parseStructuredQuery(input);
      expect(result?.map((r) => r.type)).toEqual(["hyde", "lex", "vec"]);
    });
  });

  describe("error cases", () => {
    it("mixed plain + prefixed throws", () => {
      expect(() =>
        parseStructuredQuery("plain text\nlex: keyword"),
      ).toThrowError(/mix/i);
    });

    it("expand: mixed with typed throws", () => {
      expect(() =>
        parseStructuredQuery("expand: something\nlex: keyword"),
      ).toThrowError(/mix/i);
    });

    it("expand: without text throws", () => {
      expect(() => parseStructuredQuery("expand:")).toThrowError(/empty/i);
    });

    it("typed line without text throws", () => {
      expect(() => parseStructuredQuery("lex:")).toThrowError(/empty/i);
      expect(() => parseStructuredQuery("vec:   ")).toThrowError(/empty/i);
    });
  });

  describe("whitespace handling", () => {
    it("blank lines between queries ignored", () => {
      expect(parseStructuredQuery("lex: one\n\nvec: two")).toEqual([
        { type: "lex", query: "one", line: 1 },
        { type: "vec", query: "two", line: 3 },
      ]);
    });

    it("whitespace-only lines ignored", () => {
      expect(parseStructuredQuery("lex: one\n   \nvec: two")).toEqual([
        { type: "lex", query: "one", line: 1 },
        { type: "vec", query: "two", line: 3 },
      ]);
    });

    it("leading/trailing whitespace trimmed", () => {
      expect(parseStructuredQuery("  lex: hello  ")).toEqual([
        { type: "lex", query: "hello", line: 1 },
      ]);
    });

    it("internal whitespace in query preserved", () => {
      expect(parseStructuredQuery("lex: hello   world")).toEqual([
        { type: "lex", query: "hello   world", line: 1 },
      ]);
    });
  });

  describe("edge cases", () => {
    it("colon in query text preserved", () => {
      expect(parseStructuredQuery("lex: key: value pair")).toEqual([
        { type: "lex", query: "key: value pair", line: 1 },
      ]);
    });

    it("prefix-like text inside query preserved", () => {
      expect(parseStructuredQuery("vec: search for lex: patterns")).toEqual([
        { type: "vec", query: "search for lex: patterns", line: 1 },
      ]);
    });
  });
});

describe("validateLexQuery", () => {
  it("accepts basic query — returns null", () => {
    expect(validateLexQuery("CAP theorem")).toBeNull();
  });

  it("rejects newline — returns error string", () => {
    const result = validateLexQuery("line one\nline two");
    expect(result).toBeTypeOf("string");
    expect(result).toMatch(/newline/i);
  });

  it("rejects unmatched quote — returns error string", () => {
    const result = validateLexQuery('hello "world');
    expect(result).toBeTypeOf("string");
    expect(result).toMatch(/quote/i);
  });
});

describe("validateSemanticQuery", () => {
  it("accepts plain language — returns null", () => {
    expect(validateSemanticQuery("how does consensus work")).toBeNull();
  });

  it("rejects negation (-term) — returns error string", () => {
    const result = validateSemanticQuery("consensus -paxos");
    expect(result).toBeTypeOf("string");
    expect(result).toMatch(/negat/i);
  });

  it("accepts hypothetical passage — returns null", () => {
    expect(
      validateSemanticQuery(
        "A hypothetical passage about distributed consensus algorithms",
      ),
    ).toBeNull();
  });
});
