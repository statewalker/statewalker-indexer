import type {
  AnySubIndexBinding,
  Index,
  SearchRequest,
  SearchResult,
} from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";
import { type FullTextIndex, type FulltextResult, newFullTextAccess } from "../src/index.js";

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

function fakeFts(): FullTextIndex {
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
    getIndexInfo: async () => ({ language: "en" }),
  };
}

describe("newFullTextAccess(name)", () => {
  it("exposes the bound name", () => {
    expect(newFullTextAccess("q").name).toBe("q");
  });

  it("get throws when no sub-index named `name` is registered on the Index", () => {
    const access = newFullTextAccess("q");
    const index = fakeIndex("docs");
    expect(() => access.get(index)).toThrow(/q/);
    // Error message also names the parent Index for diagnosability.
    try {
      access.get(index);
    } catch (e) {
      expect((e as Error).message).toContain("docs");
    }
  });

  it("tryGet returns undefined for an unregistered sub-index", () => {
    expect(newFullTextAccess("q").tryGet(fakeIndex())).toBeUndefined();
  });

  it("get returns the registered FullTextIndex instance", () => {
    const index = fakeIndex();
    const fts = fakeFts();
    index.setBinding({ name: "q", type: "fulltext", config: { language: "en" }, index: fts });
    expect(newFullTextAccess("q").get(index)).toBe(fts);
  });

  it("setQuery / getQuery round-trip on a SearchRequest under the bound name", () => {
    const access = newFullTextAccess("q");
    const req: SearchRequest = { topK: 5 };
    expect(access.getQuery(req)).toBeUndefined();
    access.setQuery(req, { queries: ["hello"] });
    expect(access.getQuery(req)).toEqual({ queries: ["hello"] });
    expect(req.subQueries?.q).toEqual({ queries: ["hello"] });
  });

  it("getResult reads a sub-result attached under the bound name", () => {
    const access = newFullTextAccess("q");
    const res: SearchResult = { path: "/d/a", blockId: "b1", score: 0.5 };
    expect(access.getResult(res)).toBeUndefined();
    res.subResults = {
      q: {
        path: "/d/a",
        blockId: "b1",
        score: 0.99,
        snippet: "snip",
      } satisfies FulltextResult,
    };
    expect(access.getResult(res)?.snippet).toBe("snip");
  });

  it("two access handles bound to distinct names do not interfere", () => {
    const enFts = newFullTextAccess("q");
    const frFts = newFullTextAccess("q_fr");
    const req: SearchRequest = { topK: 5 };
    enFts.setQuery(req, { queries: ["hello"] });
    frFts.setQuery(req, { queries: ["bonjour"] });
    expect(enFts.getQuery(req)).toEqual({ queries: ["hello"] });
    expect(frFts.getQuery(req)).toEqual({ queries: ["bonjour"] });
  });
});
