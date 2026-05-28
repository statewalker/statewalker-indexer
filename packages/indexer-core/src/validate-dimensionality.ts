import type { VectorIndexInfo } from "@statewalker/indexer-vector";

export function validateDimensionality(
  info: Pick<VectorIndexInfo, "dimensionality">,
  embedding: Float32Array,
): void {
  if (embedding.length !== info.dimensionality) {
    throw new Error(`Expected dimensionality ${info.dimensionality}, got ${embedding.length}`);
  }
}
