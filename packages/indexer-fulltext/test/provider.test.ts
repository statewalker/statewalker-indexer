import type { CreateIndexParams } from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";
import {
  type FullTextConfig,
  type FullTextIndex,
  type FullTextProvider,
  getFullTextConfig,
  setFullTextConfig,
} from "../src/index.js";

describe("FullTextProvider", () => {
  it("has type === 'fulltext' and constructs a FullTextIndex from a config", () => {
    const stub = {} as FullTextIndex;
    const provider: FullTextProvider = {
      type: "fulltext",
      create: (_config: FullTextConfig) => stub,
    };
    expect(provider.type).toBe("fulltext");
    expect(provider.create({ language: "english" })).toBe(stub);
  });
});

describe("FullTextConfig helpers (name-keyed)", () => {
  it("setFullTextConfig writes { type, ...config } under params.subIndexes[name]", () => {
    const params: CreateIndexParams = { name: "docs" };
    setFullTextConfig(params, "q", { language: "english" });
    expect(params.subIndexes).toEqual({ q: { type: "fulltext", language: "english" } });
  });

  it("two distinct names of the same modality both end up in subIndexes", () => {
    const params: CreateIndexParams = { name: "docs" };
    setFullTextConfig(params, "q", { language: "english" });
    setFullTextConfig(params, "q_fr", { language: "french" });
    expect(params.subIndexes).toEqual({
      q: { type: "fulltext", language: "english" },
      q_fr: { type: "fulltext", language: "french" },
    });
  });

  it("getFullTextConfig reads a previously written config back, stripping nothing", () => {
    const params: CreateIndexParams = { name: "docs" };
    setFullTextConfig(params, "q", { language: "english" });
    expect(getFullTextConfig(params, "q")).toEqual({ language: "english" });
  });

  it("getFullTextConfig returns undefined for a name not set or for a different type", () => {
    const params: CreateIndexParams = { name: "docs" };
    expect(getFullTextConfig(params, "absent")).toBeUndefined();
    params.subIndexes = { other: { type: "vector", dimensionality: 3, model: "x" } };
    expect(getFullTextConfig(params, "other")).toBeUndefined();
  });
});
