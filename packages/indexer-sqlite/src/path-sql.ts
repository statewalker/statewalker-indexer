/**
 * SQL condition matching `column` under any of `prefixes`, on path-component
 * boundaries (`/foo` matches `/foo` and `/foo/x`, never `/foobar`) and
 * case-sensitively. Uses `substr` rather than `LIKE`: SQLite's `LIKE` ignores
 * ASCII case, and `PRAGMA case_sensitive_like` is not authorised in Durable
 * Objects. No prefixes → `1` (no constraint).
 */
export function pathPrefixSql(
  column: string,
  prefixes: readonly string[],
): { sql: string; params: string[] } {
  if (prefixes.length === 0) return { sql: "1", params: [] };
  const parts: string[] = [];
  const params: string[] = [];
  for (const prefix of prefixes) {
    if (prefix.endsWith("/")) {
      parts.push(`substr(${column}, 1, length(?)) = ?`);
      params.push(prefix, prefix);
    } else {
      parts.push(`(${column} = ? OR substr(${column}, 1, length(?)) = ?)`);
      params.push(prefix, `${prefix}/`, `${prefix}/`);
    }
  }
  return { sql: `(${parts.join(" OR ")})`, params };
}
