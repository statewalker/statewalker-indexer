import type { CreateIndexParams } from "@statewalker/indexer-api";
import { FULL_TEXT_TYPE, type FullTextConfig } from "./types.js";

/**
 * Write a full-text config for the sub-index named `name` into
 * `params.subIndexes`. Initialises the map if absent. The resulting entry
 * is `{ type: "fulltext", ...config }` — the Indexer uses the `type` to find
 * the matching `FullTextProvider` at create time.
 */
export function setFullTextConfig(
  params: CreateIndexParams,
  name: string,
  config: FullTextConfig,
): void {
  if (!params.subIndexes) params.subIndexes = {};
  params.subIndexes[name] = { type: FULL_TEXT_TYPE, ...config };
}

/**
 * Read the full-text config for the sub-index named `name` from `params`.
 * Returns `undefined` if no entry exists or if the entry's `type` is not
 * `"fulltext"`.
 */
export function getFullTextConfig(
  params: CreateIndexParams,
  name: string,
): FullTextConfig | undefined {
  const entry = params.subIndexes?.[name];
  if (!entry || entry.type !== FULL_TEXT_TYPE) return undefined;
  const { type: _type, ...rest } = entry;
  return rest as unknown as FullTextConfig;
}
