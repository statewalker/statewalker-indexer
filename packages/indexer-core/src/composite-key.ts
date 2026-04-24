import type { DocumentPath } from "@statewalker/indexer-api";

export function compositeKey(path: DocumentPath, blockId: string): string {
  return `${path}\0${blockId}`;
}
