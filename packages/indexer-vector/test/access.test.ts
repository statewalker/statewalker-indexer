import type {
  AnySubIndexBinding,
  Index,
  SearchRequest,
  SearchResult,
} from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";
import { newVectorAccess, type VectorIndex, type VectorResult } from "../src/index.js";

function fakeIndex(name = "docs"): Index {
  const bindings = new Map<string, AnySubIndexBinding>();
  return {
    name,
    setBinding: (b) => {
      bindings.set(b.name, b);
    },
    getBinding: (k) => bindings.get(k),
    getBindings: () => bindings.values(),
    async *search() {},
    async deleteDocuments() {},
    async flush() {},
    async close() {},
    async deleteIndex() {},
  };
}

function fakeVec(): VectorIndex {
  const noop = (async () => undefined) as never;
  return {
    async *search() {},
    addDocument: noop,
    addDocuments: noop,
    deleteDocuments: noop,
    getSize: async () => 0,
    async *getDocumentPaths() {},
    async *getDocumentBlocksRefs() {},
    async *getDocumentsBlocks() {},
    close: noop,
    flush: noop,
    deleteIndex: noop,
    getIndexInfo: async () => ({ dimensionality: 3, model: "fake" }),
  };
}

describe("newVectorAccess(name)", () => {
  it("exposes the bound name", () => {
    expect(newVectorAccess("semantic").name).toBe("semantic");
  });

  it("get throws when no sub-index named `name` is registered", () => {
    expect(() => newVectorAccess("semantic").get(fakeIndex("docs"))).toThrow(/semantic/);
  });

  it("tryGet returns undefined for an unregistered sub-index", () => {
    expect(newVectorAccess("semantic").tryGet(fakeIndex())).toBeUndefined();
  });

  it("get returns the registered VectorIndex instance", () => {
    const index = fakeIndex();
    const vec = fakeVec();
    index.setBinding({
      name: "semantic",
      type: "vector",
      config: { dimensionality: 3, model: "m" },
      index: vec,
    });
    expect(newVectorAccess("semantic").get(index)).toBe(vec);
  });

  it("setQuery / getQuery round-trip under the bound name", () => {
    const access = newVectorAccess("semantic");
    const req: SearchRequest = { topK: 5 };
    access.setQuery(req, { embeddings: [new Float32Array([1, 0, 0])] });
    expect(access.getQuery(req)?.embeddings[0]?.[0]).toBe(1);
  });

  it("getResult reads a sub-result attached under the bound name", () => {
    const access = newVectorAccess("semantic");
    const res: SearchResult = { path: "/d/a", blockId: "b1", score: 0.5 };
    expect(access.getResult(res)).toBeUndefined();
    res.subResults = {
      semantic: { path: "/d/a", blockId: "b1", score: 0.9 } satisfies VectorResult,
    };
    expect(access.getResult(res)?.score).toBe(0.9);
  });

  it("two access handles bound to distinct names do not interfere", () => {
    const a = newVectorAccess("semantic");
    const b = newVectorAccess("semantic_meta");
    const req: SearchRequest = { topK: 5 };
    a.setQuery(req, { embeddings: [new Float32Array([1])] });
    b.setQuery(req, { embeddings: [new Float32Array([2])] });
    expect(a.getQuery(req)?.embeddings[0]?.[0]).toBe(1);
    expect(b.getQuery(req)?.embeddings[0]?.[0]).toBe(2);
  });
});
