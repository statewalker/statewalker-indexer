/**
 * SQL condition matching `column` under any of `prefixes`, on path-component
 * boundaries (`/foo` matches `/foo` and `/foo/x`, never `/foobar`) and
 * case-sensitively. Uses `substr` rather than `LIKE`: SQLite's `LIKE` ignores
 * ASCII case, and `PRAGMA case_sensitive_like` is not authorised in Durable
 * Objects. `column` must be table-qualified (`b.path`): `json_each` has a `path`
 * column of its own. No prefixes → `1` (no constraint).
 */
export function pathPrefixSql(
  column: string,
  prefixes: readonly string[],
): { sql: string; params: string[] } {
  if (prefixes.length === 0) return { sql: "1", params: [] };
  // One JSON parameter, however many prefixes: Durable Objects cap bound variables at 100.
  const sql = `EXISTS (SELECT 1 FROM json_each(?) p WHERE CASE WHEN substr(p.value, -1) = '/' THEN substr(${column}, 1, length(p.value)) = p.value ELSE ${column} = p.value OR substr(${column}, 1, length(p.value) + 1) = p.value || '/' END)`;
  return { sql, params: [JSON.stringify(prefixes)] };
}
