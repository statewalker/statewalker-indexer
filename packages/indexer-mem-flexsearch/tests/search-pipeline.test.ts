import type { DocumentPath, Index } from "@statewalker/indexer-api";
import {
  createMockCitationBuilder,
  createMockExpander,
  createMockReranker,
  SearchPipeline,
} from "@statewalker/indexer-search";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlexSearchIndexer } from "../src/index.js";

let indexer: ReturnType<typeof createFlexSearchIndexer>;
let index: Index;

const testDocs = [
  {
    blockId: "d1",
    path: "/science/physics" as DocumentPath,
    content: "quantum mechanics physics particles",
  },
  {
    blockId: "d2",
    path: "/tech/programming" as DocumentPath,
    content: "javascript async programming patterns",
  },
  {
    blockId: "d3",
    path: "/tech/quantum" as DocumentPath,
    content: "quantum computing programming algorithms",
  },
  {
    blockId: "d4",
    path: "/lifestyle/food" as DocumentPath,
    content: "cooking pasta italian food recipes",
  },
];

beforeEach(async () => {
  indexer = createFlexSearchIndexer();
  index = await indexer.createIndex({
    name: "test",
    fulltext: { language: "en" },
  });
  for (const doc of testDocs) {
    await index.addDocument([doc]);
  }
});

afterEach(async () => {
  await indexer.close();
});

describe("SearchPipeline — Builder", () => {
  it("constructor requires index in config", () => {
    const pipeline = new SearchPipeline({ index });
    expect(pipeline).toBeDefined();
  });

  it("builder methods return this (chainable)", () => {
    const pipeline = new SearchPipeline({ index });
    const result = pipeline
      .setPrompt("test")
      .setTopK(5)
      .setPaths("/a/" as DocumentPath)
      .setExplain(true);
    expect(result).toBe(pipeline);
  });

  it("setTopK defaults to 10 if not set", async () => {
    const results = await new SearchPipeline({ index }).setTextQueries("quantum").execute();
    expect(results.length).toBeLessThanOrEqual(10);
  });
});

describe("SearchPipeline — Execution (FTS only, no LLM)", () => {
  it("setTextQueries returns matching documents", async () => {
    const results = await new SearchPipeline({ index })
      .setTextQueries("quantum")
      .setTopK(10)
      .execute();

    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map((r) => r.blockId);
    expect(ids).toContain("d1");
    expect(ids).toContain("d3");
  });

  it("multiple text queries return relevant documents", async () => {
    const results = await new SearchPipeline({ index })
      .setTextQueries("quantum", "programming")
      .setTopK(10)
      .execute();

    const ids = results.map((r) => r.blockId);
    expect(ids).toContain("d3");
  });

  it("setPaths prefix filters results", async () => {
    const results = await new SearchPipeline({ index })
      .setTextQueries("quantum")
      .setPaths("/science/" as DocumentPath)
      .setTopK(10)
      .execute();

    expect(results.length).toBe(1);
    expect(results[0]?.blockId).toBe("d1");
  });

  it("topK limits result count", async () => {
    const results = await new SearchPipeline({ index })
      .setTextQueries("quantum", "programming", "cooking")
      .setTopK(2)
      .execute();

    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe("SearchPipeline — Execution with Expansion", () => {
  it("setPrompt calls expander(prompt)", async () => {
    const innerExpander = createMockExpander();
    const expander = vi.fn(innerExpander);
    const embedFn = async () => new Float32Array(3);

    await new SearchPipeline({ index, expander, embedFn })
      .setPrompt("quantum physics")
      .setTopK(10)
      .execute();

    expect(expander).toHaveBeenCalledWith("quantum physics");
  });

  it("skip('expansion') — prompt used as-is for FTS", async () => {
    const innerExpander = createMockExpander();
    const expander = vi.fn(innerExpander);

    const results = await new SearchPipeline({ index, expander })
      .setPrompt("quantum")
      .skip("expansion")
      .setTopK(10)
      .execute();

    expect(expander).not.toHaveBeenCalled();
    expect(results.length).toBeGreaterThan(0);
  });

  it("no expander in config — prompt used as-is (no error)", async () => {
    const results = await new SearchPipeline({ index }).setPrompt("quantum").setTopK(10).execute();

    expect(results.length).toBeGreaterThan(0);
  });
});

describe("SearchPipeline — Execution with Reranking", () => {
  it("reranker called with top candidates", async () => {
    const reranker = vi.fn(
      createMockReranker(
        new Map([
          ["d1", 0.9],
          ["d3", 0.7],
        ]),
      ),
    );

    await new SearchPipeline({ index, reranker }).setTextQueries("quantum").setTopK(10).execute();

    expect(reranker).toHaveBeenCalled();
  });

  it("skip('rerank') — retrieval results returned without blending", async () => {
    const reranker = vi.fn(createMockReranker());

    await new SearchPipeline({ index, reranker })
      .setTextQueries("quantum")
      .skip("rerank")
      .setTopK(10)
      .execute();

    expect(reranker).not.toHaveBeenCalled();
  });

  it("setReranker overrides config reranker", async () => {
    const configReranker = vi.fn(createMockReranker());
    const overrideReranker = vi.fn(createMockReranker());

    await new SearchPipeline({ index, reranker: configReranker })
      .setTextQueries("quantum")
      .setReranker(overrideReranker)
      .setTopK(10)
      .execute();

    expect(configReranker).not.toHaveBeenCalled();
    expect(overrideReranker).toHaveBeenCalled();
  });
});

describe("SearchPipeline — Execution with Citations", () => {
  it("citations attached to top results", async () => {
    const citationBuilder = createMockCitationBuilder();

    const results = await new SearchPipeline({ index, citationBuilder })
      .setTextQueries("quantum")
      .setTopK(10)
      .execute();

    const withCitation = results.filter((r) => r.citation);
    expect(withCitation.length).toBeGreaterThan(0);
  });

  it("skip('citations') — no citations in output", async () => {
    const citationBuilder = createMockCitationBuilder();

    const results = await new SearchPipeline({ index, citationBuilder })
      .setTextQueries("quantum")
      .skip("citations")
      .setTopK(10)
      .execute();

    for (const r of results) {
      expect(r.citation).toBeUndefined();
    }
  });
});

describe("SearchPipeline — Explain traces", () => {
  it("setExplain(true) — each entry has explain object", async () => {
    const results = await new SearchPipeline({ index })
      .setTextQueries("quantum")
      .setExplain(true)
      .setTopK(10)
      .execute();

    for (const r of results) {
      expect(r.explain).toBeDefined();
      expect(r.explain?.retrievalScore).toBeGreaterThan(0);
      expect(r.explain?.blendedScore).toBeGreaterThan(0);
    }
  });

  it("setExplain(false) — no explain in output (default)", async () => {
    const results = await new SearchPipeline({ index })
      .setTextQueries("quantum")
      .setTopK(10)
      .execute();

    for (const r of results) {
      expect(r.explain).toBeUndefined();
    }
  });
});

describe("SearchPipeline — Error handling", () => {
  it("throws if no queries, embeddings, or prompt provided", async () => {
    await expect(new SearchPipeline({ index }).execute()).rejects.toThrow("No queries");
  });

  it("throws if semanticQueries provided but no embedFn", async () => {
    await expect(
      new SearchPipeline({ index }).setSemanticQueries("test").execute(),
    ).rejects.toThrow("embedFn");
  });
});
