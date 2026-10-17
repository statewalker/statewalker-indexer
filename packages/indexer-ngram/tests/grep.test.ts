import type { AnySubIndexBinding, Index } from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";
import {
  grep,
  NGRAM_TYPE,
  type NgramIndex,
  type NgramQuery,
  type NgramResult,
} from "../src/index.js";

function indexWith(name: string, sub: Partial<NgramIndex>): Index {
  const binding = {
    name,
    type: NGRAM_TYPE,
    config: {},
    index: sub,
  } as unknown as AnySubIndexBinding;
  return {
    name: "idx",
    getBinding: (n: string) => (n === name ? binding : undefined),
  } as unknown as Index;
}

describe("grep", () => {
  it("collects every hit and returns the search summary's truncated flag", async () => {
    const seen: NgramQuery[] = [];
    const hit: NgramResult = { path: "/a", blockId: "b", score: 2, count: 2, matches: [] };
    const index = indexWith("g", {
      async *search(q: NgramQuery) {
        seen.push(q);
        yield hit;
        return { truncated: true };
      },
    });
    const result = await grep(index, "g", "foo", { caseSensitive: false });
    expect(result).toEqual({ hits: [hit], truncated: true });
    expect(seen).toEqual([{ caseSensitive: false, pattern: "foo" }]);
  });

  it("reports truncated: false when the index returns no summary", async () => {
    const index = indexWith("g", {
      // biome-ignore lint/correctness/useYield: no hits, no summary
      async *search() {
        return undefined;
      },
    });
    expect(await grep(index, "g", "x")).toEqual({ hits: [], truncated: false });
  });

  it("throws when no sub-index has that name", async () => {
    await expect(grep(indexWith("g", {}), "missing", "x")).rejects.toThrow(
      'No sub-index named "missing" is registered on index "idx"',
    );
  });
});
