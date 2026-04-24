import type { EmbeddingIndexInfo } from "@statewalker/indexer-api";

export function validateDimensionality(
  info: Pick<EmbeddingIndexInfo, "dimensionality">,
  embedding: Float32Array,
): void {
  if (embedding.length !== info.dimensionality) {
    throw new Error(
      `Expected dimensionality ${info.dimensionality}, got ${embedding.length}`,
    );
  }
}
