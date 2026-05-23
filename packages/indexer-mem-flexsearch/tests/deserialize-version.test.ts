import type { FullTextIndexInfo } from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";
import { FlexSearchFullTextIndex } from "../src/flexsearch-full-text-index.js";

const info: FullTextIndexInfo = { language: "en" };

describe("FlexSearchFullTextIndex.deserialize — unsupported version", () => {
  it("throws when the payload version is unknown rather than returning an empty index", () => {
    const stale = JSON.stringify({
      version: 2,
      chunks: {},
      blocks: [{ path: "/a", blockId: "b1", content: "hello" }],
      keyToNum: [],
      nextNum: 1,
    });

    expect(() => FlexSearchFullTextIndex.deserialize(info, stale)).toThrow(/version/i);
  });

  it("throws when the version field is missing entirely", () => {
    const stale = JSON.stringify({
      chunks: {},
      blocks: [{ path: "/a", blockId: "b1", content: "hello" }],
      keyToNum: [],
      nextNum: 1,
    });

    expect(() => FlexSearchFullTextIndex.deserialize(info, stale)).toThrow(/version/i);
  });
});
