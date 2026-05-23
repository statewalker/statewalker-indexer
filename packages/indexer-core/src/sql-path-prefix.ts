/**
 * Helpers that turn a path prefix into a safe SQL LIKE condition.
 *
 * SQL backends share two concerns: (1) LIKE metacharacters in the bound value
 * must be neutralised so callers can't widen the match with `%` or `_`;
 * (2) prefix matching must respect path-component boundaries — `/foo` must not
 * match `/foobar`. Both rules are kept in one place so every retriever and
 * dialect stays in sync.
 */

export function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface PathPrefixSql {
  /** SQL fragment to drop directly into a WHERE clause. */
  sql: string;
  /** Parameter values to push onto the bind list, in order. */
  params: string[];
}

/**
 * Build a SQL condition matching paths under `prefix` with path-component
 * boundary semantics. Allocates one or two parameter slots starting at
 * `startParamIndex` (1-based).
 */
export function buildPathPrefixSql(
  column: string,
  prefix: string,
  startParamIndex: number,
): PathPrefixSql {
  const escaped = escapeLikePattern(prefix);
  if (prefix.endsWith("/")) {
    return {
      sql: `${column} LIKE $${startParamIndex} ESCAPE '\\'`,
      params: [`${escaped}%`],
    };
  }
  return {
    sql: `(${column} = $${startParamIndex} OR ${column} LIKE $${startParamIndex + 1} ESCAPE '\\')`,
    params: [prefix, `${escaped}/%`],
  };
}

/**
 * Build an OR of per-prefix subclauses. Returns an empty SQL fragment when
 * given no prefixes — callers should treat that as "no path constraint".
 */
export function buildPathPrefixesSql(
  column: string,
  prefixes: string[],
  startParamIndex: number,
): PathPrefixSql {
  if (prefixes.length === 0) return { sql: "", params: [] };
  const parts: string[] = [];
  const params: string[] = [];
  let idx = startParamIndex;
  for (const prefix of prefixes) {
    const sub = buildPathPrefixSql(column, prefix, idx);
    parts.push(sub.sql);
    params.push(...sub.params);
    idx += sub.params.length;
  }
  return { sql: `(${parts.join(" OR ")})`, params };
}
