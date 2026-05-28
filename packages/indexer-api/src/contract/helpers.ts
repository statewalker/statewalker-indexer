// =============================================================================
// Indexer Contract — Name-parametric helpers
//
// Read/write a sub-index's sub-query on a SearchRequest or sub-result on a
// SearchResult, addressed by runtime sub-index name. The kernel never knows
// modality types; the caller supplies the type via the generic `Q` / `R`.
//
// These helpers replace the retired per-modality-key adapter triple
// (`newSubIndex` / `newSubQuery` / `newSubResult`) — multi-instance support
// requires runtime-named addressing.
// =============================================================================

import type { SearchRequest, SearchResult } from "./types.js";

/**
 * Read the sub-query under `name` from `request`, returning `undefined` when
 * absent. The caller asserts the payload's type via the generic `Q`.
 */
export function getSubQuery<Q = unknown>(request: SearchRequest, name: string): Q | undefined {
  return request.subQueries?.[name] as Q | undefined;
}

/**
 * Write `query` as the sub-query under `name` on `request`. Initialises
 * `request.subQueries` if absent.
 */
export function setSubQuery<Q = unknown>(request: SearchRequest, name: string, query: Q): void {
  if (!request.subQueries) request.subQueries = {};
  request.subQueries[name] = query;
}

/**
 * Read the sub-result under `name` from `result`, returning `undefined` when
 * absent. The caller asserts the payload's type via the generic `R`.
 */
export function getSubResult<R = unknown>(result: SearchResult, name: string): R | undefined {
  return result.subResults?.[name] as R | undefined;
}

/**
 * Write `hit` as the sub-result under `name` on `result`. Initialises
 * `result.subResults` if absent.
 */
export function setSubResult<R = unknown>(result: SearchResult, name: string, hit: R): void {
  if (!result.subResults) result.subResults = {};
  result.subResults[name] = hit;
}
