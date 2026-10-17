import type { CreateIndexParams } from "@statewalker/indexer-api";
import { NGRAM_TYPE, type NgramConfig } from "./types.js";

/** Write an n-gram config for the sub-index named `name` into `params.subIndexes`. */
export function setNgramConfig(params: CreateIndexParams, name: string, config: NgramConfig): void {
  if (!params.subIndexes) params.subIndexes = {};
  params.subIndexes[name] = { type: NGRAM_TYPE, ...config };
}

/** Read the n-gram config for the sub-index named `name`, if any. */
export function getNgramConfig(params: CreateIndexParams, name: string): NgramConfig | undefined {
  const entry = params.subIndexes?.[name];
  if (!entry || entry.type !== NGRAM_TYPE) return undefined;
  const { type: _type, ...rest } = entry;
  return rest as NgramConfig;
}
