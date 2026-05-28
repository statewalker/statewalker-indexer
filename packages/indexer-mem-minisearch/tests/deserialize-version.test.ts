import type { FullTextIndexInfo } from "@statewalker/indexer-fulltext";
import { describe, expect, it } from "vitest";
import { MiniSearchFullTextIndex } from "../src/minisearch-full-text-index.js";

const info: FullTextIndexInfo = { language: "en" };

describe("MiniSearchFullTextIndex.deserialize — unsupported version", () => {
  it("throws when the payload version is unknown rather than returning an empty index", () => {
    const stale = JSON.stringify({
      version: 2,
      miniSearch: {},
      blocks: [{ path: "/a", blockId: "b1", content: "hello" }],
      keys: [],
    });

    expect(() => MiniSearchFullTextIndex.deserialize(info, stale)).toThrow(/version/i);
  });

  it("throws when the version field is missing entirely", () => {
    const stale = JSON.stringify({
      miniSearch: {},
      blocks: [{ path: "/a", blockId: "b1", content: "hello" }],
      keys: [],
    });

    expect(() => MiniSearchFullTextIndex.deserialize(info, stale)).toThrow(/version/i);
  });
});
