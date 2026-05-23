import type { DocumentPath } from "@statewalker/indexer-api";

/**
 * Tests whether `path` is contained under the path-tree rooted at `prefix`.
 *
 * Matches on path-component boundaries, not raw character prefix: `/foo` matches
 * `/foo` and `/foo/anything` but never `/foobar`. A prefix ending in `/` is
 * accepted as-is; otherwise an implicit separator is required.
 */
export function matchesPrefix(path: DocumentPath, prefix: DocumentPath): boolean {
  if (path === prefix) return true;
  if (prefix.endsWith("/")) return path.startsWith(prefix);
  return path.startsWith(`${prefix}/`);
}
