import type { DocumentPath, EmbedFn, Index } from "@statewalker/indexer-api";
import { embedAndAdd } from "@statewalker/indexer-search";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFlexSearchIndexer } from "../src/index.js";

let indexer: ReturnType<typeof createFlexSearchIndexer>;
let index: Index;

const noopEmbed: EmbedFn = async () => new Float32Array();

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

describe("embedAndAdd (FTS-only backend)", () => {
  it("ingests documents from a sync iterable", async () => {
    const docs = [
      { path: "/docs/" as DocumentPath, blockId: "b1", content: "hello world" },
      { path: "/docs/" as DocumentPath, blockId: "b2", content: "foo bar" },
    ];

    await embedAndAdd(index, noopEmbed, docs);
    expect(await index.getSize()).toBe(2);
  });

  it("ingested documents are searchable", async () => {
    await embedAndAdd(index, noopEmbed, [
      { path: "/docs/" as DocumentPath, blockId: "b1", content: "quantum mechanics physics" },
    ]);

    const results: Array<{ blockId: string }> = [];
    for await (const r of index.search({ queries: ["quantum"], topK: 10 })) {
      results.push(r);
    }
    expect(results.length).toBe(1);
    expect(results[0]?.blockId).toBe("b1");
  });

  it("ingests documents from an async iterable", async () => {
    async function* generateDocs() {
      yield { path: "/docs/" as DocumentPath, blockId: "a1", content: "async document one" };
      yield { path: "/docs/" as DocumentPath, blockId: "a2", content: "async document two" };
    }

    await embedAndAdd(index, noopEmbed, generateDocs());
    expect(await index.getSize()).toBe(2);
  });
});

describe("embedAndAdd (FTS + vector backend)", () => {
  it("calls embed for every document", async () => {
    const indexerWithVec = createFlexSearchIndexer();
    const vecIndex = await indexerWithVec.createIndex({
      name: "vec-test",
      fulltext: { language: "en" },
      vector: { dimensionality: 3, model: "test" },
    });

    let embedCalls = 0;
    const embed: EmbedFn = async () => {
      embedCalls++;
      return new Float32Array([0.1, 0.2, 0.3]);
    };

    await embedAndAdd(vecIndex, embed, [
      { path: "/docs/" as DocumentPath, blockId: "e1", content: "embedding test" },
    ]);

    expect(await vecIndex.getSize()).toBe(1);
    expect(embedCalls).toBe(1);

    await indexerWithVec.close();
  });
});
