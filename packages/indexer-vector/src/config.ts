import type { CreateIndexParams } from "@statewalker/indexer-api";
import { VECTOR_TYPE, type VectorConfig } from "./types.js";

/** Write a vector config for the sub-index named `name` into `params.subIndexes`. */
export function setVectorConfig(
  params: CreateIndexParams,
  name: string,
  config: VectorConfig,
): void {
  if (!params.subIndexes) params.subIndexes = {};
  params.subIndexes[name] = { type: VECTOR_TYPE, ...config };
}

/** Read the vector config for the sub-index named `name` from `params`, if any. */
export function getVectorConfig(params: CreateIndexParams, name: string): VectorConfig | undefined {
  const entry = params.subIndexes?.[name];
  if (!entry || entry.type !== VECTOR_TYPE) return undefined;
  const { type: _type, ...rest } = entry;
  return rest as unknown as VectorConfig;
}
