import type { DocumentPath } from "@statewalker/indexer-api";

export function matchesPrefix(path: DocumentPath, prefix: DocumentPath): boolean {
  return path.startsWith(prefix);
}
