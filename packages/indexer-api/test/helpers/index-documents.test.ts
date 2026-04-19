import { createFlexSearchIndexer } from "@statewalker/indexer-mem-flexsearch";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexDocuments } from "../../src/helpers/index-documents.js";
import type { DocumentPath, Index } from "../../src/indexer-index.js";

let indexer: ReturnType<typeof createFlexSearchIndexer>;
let index: Index;

beforeEach(async () => {
  indexer = createFlexSearchIndexer();
  index = await indexer.createIndex({
    name: "test",
    fulltext: { language: "en" },
  });
});

afterEach(async () => {
  await indexer.close();
});

describe("indexDocuments", () => {
  it("indexes documents from a sync iterable", async () => {
    const docs = [
      { path: "/docs/" as DocumentPath, blockId: "b1", content: "hello world" },
      { path: "/docs/" as DocumentPath, blockId: "b2", content: "foo bar" },
    ];

    const result = await indexDocuments(index, docs);
    expect(result.indexed).toBe(2);
  });

  it("indexed documents are searchable", async () => {
    const docs = [
      {
        path: "/docs/" as DocumentPath,
        blockId: "b1",
        content: "quantum mechanics physics",
      },
    ];

    await indexDocuments(index, docs);

    const results: Array<{ blockId: string }> = [];
    for await (const r of index.search({ queries: ["quantum"], topK: 10 })) {
      results.push(r);
    }
    expect(results.length).toBe(1);
    expect(results[0]?.blockId).toBe("b1");
  });

  it("indexes documents from an async iterable", async () => {
    async function* generateDocs() {
      yield {
        path: "/docs/" as DocumentPath,
        blockId: "a1",
        content: "async document one",
      };
      yield {
        path: "/docs/" as DocumentPath,
        blockId: "a2",
        content: "async document two",
      };
    }

    const result = await indexDocuments(index, generateDocs());
    expect(result.indexed).toBe(2);

    const size = await index.getSize();
    expect(size).toBe(2);
  });

  it("calls embedFn when provided", async () => {
    const indexerWithVec = createFlexSearchIndexer();
    const vecIndex = await indexerWithVec.createIndex({
      name: "vec-test",
      fulltext: { language: "en" },
      vector: { dimensionality: 3, model: "test" },
    });

    const docs = [
      {
        path: "/docs/" as DocumentPath,
        blockId: "e1",
        content: "embedding test",
      },
    ];

    let embedCalled = false;
    const embedFn = async (_text: string) => {
      embedCalled = true;
      return new Float32Array([0.1, 0.2, 0.3]);
    };

    const result = await indexDocuments(vecIndex, docs, { embedFn });
    expect(result.indexed).toBe(1);
    expect(embedCalled).toBe(true);

    await indexerWithVec.close();
  });
});
