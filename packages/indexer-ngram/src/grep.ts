import type { Index } from "@statewalker/indexer-api";
import { newNgramAccess } from "./access.js";
import type { NgramQuery, NgramResult } from "./types.js";

export type GrepOptions = Omit<NgramQuery, "pattern">;

export interface GrepResult {
  hits: NgramResult[];
  /** `true` when the backend stopped early (candidate budget or `topK`); `hits` may be incomplete. */
  truncated: boolean;
}

/** Run `pattern` on the n-gram sub-index `name` of `index` and collect every hit plus the truncation flag. */
export async function grep(
  index: Index,
  name: string,
  pattern: string,
  options: GrepOptions = {},
): Promise<GrepResult> {
  const it = newNgramAccess(name)
    .get(index)
    .search({ ...options, pattern });
  const hits: NgramResult[] = [];
  for (;;) {
    const step = await it.next();
    if (step.done) return { hits, truncated: step.value?.truncated ?? false };
    hits.push(step.value);
  }
}
