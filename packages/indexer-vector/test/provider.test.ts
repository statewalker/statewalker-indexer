import type { CreateIndexParams } from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";
import {
  getVectorConfig,
  setVectorConfig,
  type VectorConfig,
  type VectorIndex,
  type VectorProvider,
} from "../src/index.js";

describe("VectorProvider", () => {
  it("has type === 'vector' and constructs a VectorIndex from a config", () => {
    const stub = {} as VectorIndex;
    const provider: VectorProvider = {
      type: "vector",
      create: (_config: VectorConfig) => stub,
    };
    expect(provider.type).toBe("vector");
    expect(provider.create({ dimensionality: 3, model: "m" })).toBe(stub);
  });
});

describe("VectorConfig helpers (name-keyed)", () => {
  it("setVectorConfig writes { type, ...config } under params.subIndexes[name]", () => {
    const params: CreateIndexParams = { name: "docs" };
    setVectorConfig(params, "semantic", { dimensionality: 384, model: "minilm" });
    expect(params.subIndexes).toEqual({
      semantic: { type: "vector", dimensionality: 384, model: "minilm" },
    });
  });

  it("two distinct names of the same modality both end up in subIndexes", () => {
    const params: CreateIndexParams = { name: "docs" };
    setVectorConfig(params, "semantic", { dimensionality: 384, model: "minilm" });
    setVectorConfig(params, "semantic_meta", { dimensionality: 512, model: "metamodel" });
    expect(Object.keys(params.subIndexes ?? {})).toEqual(["semantic", "semantic_meta"]);
  });

  it("getVectorConfig reads a previously written config back", () => {
    const params: CreateIndexParams = { name: "docs" };
    setVectorConfig(params, "semantic", { dimensionality: 384, model: "minilm" });
    expect(getVectorConfig(params, "semantic")).toEqual({ dimensionality: 384, model: "minilm" });
  });

  it("getVectorConfig returns undefined for a name not set or for a different type", () => {
    const params: CreateIndexParams = { name: "docs" };
    expect(getVectorConfig(params, "absent")).toBeUndefined();
    params.subIndexes = { other: { type: "fulltext", language: "en" } };
    expect(getVectorConfig(params, "other")).toBeUndefined();
  });
});
