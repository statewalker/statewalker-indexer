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
