import type {
  AnySubIndexBinding,
  DocumentPath,
  ScoredHit,
  SearchIndex,
  SearchRequest,
  SearchResult,
} from "@statewalker/indexer-api";
import { getSubResult, setSubQuery } from "@statewalker/indexer-api";
import { describe, expect, it, vi } from "vitest";
import { createCompositeIndex } from "../src/create-composite-index.js";

// --- Test-only modality A: snippet-bearing hits, type "alpha" --------------

interface QueryA {
  q: string;
  topK?: number;
}
interface HitA extends ScoredHit {
  snippet?: string;
}

const TYPE_A = "alpha";

// --- Test-only modality B: bare ScoredHit, type "beta" ---------------------

interface QueryB {
  q: string;
}
type HitB = ScoredHit;
const TYPE_B = "beta";

// --- Mock sub-index implementing SearchIndex base --------------------------

interface MockIndex<Q, R extends ScoredHit> extends SearchIndex<unknown, Q, R> {
  searchCalls: Q[];
}

function mockIndex<Q, R extends ScoredHit>(hits: R[]): MockIndex<Q, R> {
  const noop = vi.fn(async () => undefined) as never;
  const calls: Q[] = [];
  return {
    searchCalls: calls,
    async *search(q: Q) {
      calls.push(q);
      for (const h of hits) yield h;
    },
    addDocument: noop,
    addDocuments: noop,
    deleteDocuments: vi.fn(async () => undefined) as never,
    getSize: vi.fn(async () => 0) as never,
    async *getDocumentPaths() {},
    async *getDocumentBlocksRefs() {},
    async *getDocumentsBlocks() {},
    close: vi.fn(async () => undefined) as never,
    flush: vi.fn(async () => undefined) as never,
    deleteIndex: vi.fn(async () => undefined) as never,
  };
}

function binding<Q, R extends ScoredHit>(
  name: string,
  type: string,
  hits: R[],
): AnySubIndexBinding & { index: MockIndex<Q, R> } {
  return {
    name,
    type,
    config: {},
    index: mockIndex<Q, R>(hits),
  } as AnySubIndexBinding & { index: MockIndex<Q, R> };
}

const docA: DocumentPath = "/d/a";
const docB: DocumentPath = "/d/b";

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

describe("createCompositeIndex — open binding registry, name-keyed dispatch", () => {
  it("setBinding/getBinding/getBindings round-trip", () => {
    const idx = createCompositeIndex({ name: "t" });
    const b = binding<QueryA, HitA>("q", TYPE_A, []);
    idx.setBinding(b);
    expect(idx.getBinding("q")).toBe(b);
    expect([...idx.getBindings()]).toEqual([b]);
  });

  it("initial bindings option seeds the registry", () => {
    const a = binding<QueryA, HitA>("q", TYPE_A, []);
    const b = binding<QueryB, HitB>("z", TYPE_B, []);
    const idx = createCompositeIndex({ name: "t", bindings: [a, b] });
    expect(idx.getBinding("q")).toBe(a);
    expect(idx.getBinding("z")).toBe(b);
  });

  it("two bindings of the same modality type with distinct names coexist", () => {
    const a1 = binding<QueryA, HitA>("q", TYPE_A, []);
    const a2 = binding<QueryA, HitA>("q_fr", TYPE_A, []);
    const idx = createCompositeIndex({ name: "t", bindings: [a1, a2] });
    expect(idx.getBinding("q")).toBe(a1);
    expect(idx.getBinding("q_fr")).toBe(a2);
    expect([...idx.getBindings()]).toEqual([a1, a2]);
  });

  it("search activates only bindings whose name is present in req.subQueries", async () => {
    const a = binding<QueryA, HitA>("q", TYPE_A, [
      { path: docA, blockId: "x", score: 1, snippet: "sa" },
    ]);
    const b = binding<QueryB, HitB>("z", TYPE_B, [{ path: docB, blockId: "y", score: 1 }]);
    const idx = createCompositeIndex({ name: "t", bindings: [a, b] });

    const req: SearchRequest = { topK: 10 };
    setSubQuery<QueryA>(req, "q", { q: "anything" });
    const out = await collect(idx.search(req));
    expect(out).toHaveLength(1);
    expect(out[0]?.path).toBe(docA);
    expect(a.index.searchCalls).toHaveLength(1);
    expect(b.index.searchCalls).toHaveLength(0);
  });

  it("single-modality search yields an RRF fusion score, not the native score", async () => {
    const native = 0.875;
    const a = binding<QueryA, HitA>("q", TYPE_A, [
      { path: docA, blockId: "x", score: native, snippet: "s" },
    ]);
    const idx = createCompositeIndex({ name: "t", bindings: [a] });
    const req: SearchRequest = { topK: 5 };
    setSubQuery<QueryA>(req, "q", { q: "x" });

    const out = await collect(idx.search(req));
    expect(out).toHaveLength(1);
    expect(out[0]?.score).not.toBe(native);
    // Native magnitude survives on the sub-result under the same name "q".
    expect(getSubResult<HitA>(out[0] as SearchResult, "q")?.score).toBe(native);
  });

  it("multi-active search fuses two streams and attaches sub-results under their names", async () => {
    const a = binding<QueryA, HitA>("q", TYPE_A, [
      { path: docA, blockId: "x", score: 0.9, snippet: "sa" },
      { path: docB, blockId: "y", score: 0.5, snippet: "sb" },
    ]);
    const b = binding<QueryB, HitB>("z", TYPE_B, [
      { path: docA, blockId: "x", score: 0.7 },
      { path: docB, blockId: "y", score: 0.6 },
    ]);
    const idx = createCompositeIndex({ name: "t", bindings: [a, b] });

    const req: SearchRequest = { topK: 5 };
    setSubQuery<QueryA>(req, "q", { q: "q" });
    setSubQuery<QueryB>(req, "z", { q: "q" });

    const out = await collect(idx.search(req));
    expect(out).toHaveLength(2);
    const first = out[0] as SearchResult;
    expect(getSubResult(first, "q")).toBeDefined();
    expect(getSubResult(first, "z")).toBeDefined();
  });

  it("two same-type bindings fused as independent streams under their names", async () => {
    const en = binding<QueryA, HitA>("q", TYPE_A, [
      { path: docA, blockId: "x", score: 0.9, snippet: "english" },
    ]);
    const fr = binding<QueryA, HitA>("q_fr", TYPE_A, [
      { path: docA, blockId: "x", score: 0.85, snippet: "french" },
    ]);
    const idx = createCompositeIndex({ name: "t", bindings: [en, fr] });
    const req: SearchRequest = { topK: 5 };
    setSubQuery<QueryA>(req, "q", { q: "x" });
    setSubQuery<QueryA>(req, "q_fr", { q: "x" });

    const out = await collect(idx.search(req));
    expect(out).toHaveLength(1);
    expect(getSubResult<HitA>(out[0] as SearchResult, "q")?.snippet).toBe("english");
    expect(getSubResult<HitA>(out[0] as SearchResult, "q_fr")?.snippet).toBe("french");
  });

  it("truncates fused output to top-level topK", async () => {
    const hits: HitA[] = Array.from({ length: 20 }, (_, i) => ({
      path: docA,
      blockId: `b${i}`,
      score: 1 - i * 0.01,
    }));
    const idx = createCompositeIndex({
      name: "t",
      bindings: [binding<QueryA, HitA>("q", TYPE_A, hits)],
    });
    const req: SearchRequest = { topK: 3 };
    setSubQuery<QueryA>(req, "q", { q: "x" });
    const out = await collect(idx.search(req));
    expect(out).toHaveLength(3);
  });

  it("lifecycle fan-out hits every registered binding", async () => {
    const a = binding<QueryA, HitA>("q", TYPE_A, []);
    const b = binding<QueryB, HitB>("z", TYPE_B, []);
    const idx = createCompositeIndex({ name: "t", bindings: [a, b] });

    await idx.flush();
    expect(a.index.flush).toHaveBeenCalledOnce();
    expect(b.index.flush).toHaveBeenCalledOnce();

    await idx.deleteDocuments([{ path: docA }]);
    expect(a.index.deleteDocuments).toHaveBeenCalledOnce();
    expect(b.index.deleteDocuments).toHaveBeenCalledOnce();

    await idx.close();
    expect(a.index.close).toHaveBeenCalledOnce();
    expect(b.index.close).toHaveBeenCalledOnce();
  });

  it("operations after close throw", async () => {
    const idx = createCompositeIndex({ name: "t" });
    await idx.close();
    await expect(collect(idx.search({ topK: 5 }))).rejects.toThrow(/closed/);
    await expect(idx.flush()).rejects.toThrow(/closed/);
  });
});
