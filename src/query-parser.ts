/**
 * Structured query parser for typed search instructions (lex/vec/hyde).
 *
 * Adapted from QMD (https://github.com/tobi/qmd) by Tobi Lutke.
 * MIT License — Copyright (c) 2024-2026 Tobi Lutke.
 * See: test/structured-search.test.ts, src/store.ts (parseStructuredQuery, buildFTS5Query)
 */

export type QueryType = "lex" | "vec" | "hyde";

export interface ParsedQuery {
  type: QueryType;
  query: string;
  line?: number;
}

const TYPED_PREFIX_RE = /^(lex|vec|hyde):\s*/i;
const EXPAND_PREFIX_RE = /^expand:\s*/i;

export function parseStructuredQuery(input: string): ParsedQuery[] | null {
  const rawLines = input.split("\n");
  const entries: Array<{
    trimmed: string;
    lineNumber: number;
  }> = [];

  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = (rawLines[i] ?? "").trim();
    if (trimmed.length > 0) {
      entries.push({ trimmed, lineNumber: i + 1 });
    }
  }

  if (entries.length === 0) {
    return null;
  }

  const typed: ParsedQuery[] = [];
  const plain: string[] = [];
  let hasExpand = false;

  for (const { trimmed, lineNumber } of entries) {
    const typedMatch = TYPED_PREFIX_RE.exec(trimmed);
    if (typedMatch) {
      const prefix = typedMatch[1]?.toLowerCase() as QueryType;
      const rest = trimmed.slice(typedMatch[0].length).trim();
      if (rest.length === 0) {
        throw new Error(
          `Empty query after "${prefix}:" prefix on line ${lineNumber}`,
        );
      }
      typed.push({ type: prefix, query: rest, line: lineNumber });
      continue;
    }

    const expandMatch = EXPAND_PREFIX_RE.exec(trimmed);
    if (expandMatch) {
      const rest = trimmed.slice(expandMatch[0].length).trim();
      if (rest.length === 0) {
        throw new Error(
          `Empty query after "expand:" prefix on line ${lineNumber}`,
        );
      }
      hasExpand = true;
      continue;
    }

    plain.push(trimmed);
  }

  // expand: mixed with typed
  if (hasExpand && typed.length > 0) {
    throw new Error("Cannot mix expand: with typed (lex:/vec:/hyde:) queries");
  }

  // expand: alone => null (plain query passthrough)
  if (hasExpand) {
    return null;
  }

  // mixed plain + typed
  if (plain.length > 0 && typed.length > 0) {
    throw new Error(
      "Cannot mix plain text with typed (lex:/vec:/hyde:) queries",
    );
  }

  // all plain
  if (typed.length === 0) {
    // single plain line => null
    if (plain.length === 1) {
      return null;
    }
    // multiple plain lines is ambiguous — but per spec single unprefixed → null,
    // multiple unprefixed lines without prefixes are just a single plain query
    return null;
  }

  return typed;
}

export function validateLexQuery(query: string): string | null {
  if (/[\n\r]/.test(query)) {
    return "Lexical query must not contain newline characters";
  }

  const quoteCount = (query.match(/"/g) ?? []).length;
  if (quoteCount % 2 !== 0) {
    return "Lexical query has unmatched double quote";
  }

  return null;
}

export function validateSemanticQuery(query: string): string | null {
  // Reject standalone negation: -term or -"phrase" at word boundary
  if (/(?:^|\s)-(?:\w|")/.test(query)) {
    return "Semantic queries do not support negation (-term); use a lex: query instead";
  }

  return null;
}
