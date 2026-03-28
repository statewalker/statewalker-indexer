import type { CollectionFilter, CollectionId } from "./types.js";

/** Returns true if the filter string is a prefix (ends with "/") */
export function isCollectionPrefix(filter: string): boolean {
  return filter.length > 0 && filter.endsWith("/");
}

/**
 * Test if a collectionId matches a single filter entry.
 * If filter ends with "/", it's a prefix match (startsWith).
 * Otherwise it's an exact match.
 */
export function matchesCollection(
  collectionId: CollectionId,
  filter: string,
): boolean {
  if (isCollectionPrefix(filter)) {
    return collectionId.startsWith(filter);
  }
  return collectionId === filter;
}

/**
 * Filter a list of collectionIds by a CollectionFilter.
 * Supports exact IDs, arrays of IDs, and prefix patterns (ending with "/").
 */
export function resolveCollections(
  filter: CollectionFilter,
  allCollections: CollectionId[],
): CollectionId[] {
  const filters = Array.isArray(filter) ? filter : [filter];
  const result = new Set<CollectionId>();
  for (const id of allCollections) {
    for (const f of filters) {
      if (matchesCollection(id, f)) {
        result.add(id);
        break;
      }
    }
  }
  return [...result];
}

/** Escape SQL LIKE wildcards in a literal string */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`);
}

/**
 * Build a SQL WHERE clause fragment for collection filtering.
 * Supports exact IDs and prefix patterns (ending with "/").
 *
 * @param filter - Collection filter (single ID, array, or prefix patterns)
 * @param paramOffset - Starting parameter index ($N) for SQL placeholders
 * @returns SQL fragment and parameter values, or null if no filter
 */
export function buildCollectionClause(
  filter: CollectionFilter | undefined,
  paramOffset: number,
): { sql: string; params: (string | string[])[] } | null {
  if (filter === undefined) return null;
  const filters = Array.isArray(filter) ? filter : [filter];
  if (filters.length === 0) return null;

  // Fast path: no prefixes — use ANY($N::text[])
  if (!filters.some(isCollectionPrefix)) {
    return {
      sql: `collection_id = ANY($${paramOffset}::text[])`,
      params: [filters],
    };
  }

  // Mixed: build OR conditions
  const conditions: string[] = [];
  const params: (string | string[])[] = [];
  for (const f of filters) {
    const idx = paramOffset + params.length;
    if (isCollectionPrefix(f)) {
      conditions.push(`collection_id LIKE $${idx}`);
      params.push(`${escapeLike(f)}%`);
    } else {
      conditions.push(`collection_id = $${idx}`);
      params.push(f);
    }
  }
  const sql =
    conditions.length === 1
      ? (conditions[0] as string)
      : `(${conditions.join(" OR ")})`;
  return { sql, params };
}
