import type { DocumentPath } from "@statewalker/indexer-api";

/**
 * Joins a (path, blockId) pair into a string key safe to use as a Map key.
 *
 * Encodes both inputs as length-prefixed segments so that no character in either
 * input can collide with the delimiter (e.g. NUL inside a blockId cannot impersonate
 * a path/blockId boundary).
 */
export function compositeKey(path: DocumentPath, blockId: string): string {
  return `${path.length}:${path}|${blockId}`;
}
