import type {
  EmbeddingIndex,
  FullTextIndex,
  Index,
  Metadata,
} from "@statewalker/indexer-api";
import { createCompositeIndex } from "@statewalker/indexer-core";

/**
 * In-memory composite `Index`.
 *
 * @deprecated Use `createCompositeIndex` from `@statewalker/indexer-core` directly. Kept as a thin re-export for one transitional release.
 */
export function MemIndex(
  name: string,
  fts: FullTextIndex | null,
  vec: EmbeddingIndex | null,
  metadata?: Metadata,
): Index {
  return createCompositeIndex({ name, fts, vec, metadata });
}
