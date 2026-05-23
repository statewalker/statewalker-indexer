import type { DocumentPath, EmbeddingIndexInfo } from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";
import { MemVectorIndex } from "../src/mem-vector-index.js";

const info: EmbeddingIndexInfo = { dimensionality: 3, model: "test" };

describe("MemVectorIndex Arrow serialize/deserialize", () => {
  it("preserves metadata across the roundtrip", async () => {
    const idx = new MemVectorIndex(info);
    await idx.addDocument([
      {
        path: "/a" as DocumentPath,
        blockId: "b1",
        embedding: new Float32Array([1, 2, 3]),
        metadata: { kind: "doc", weight: 7 },
      },
      {
        path: "/a" as DocumentPath,
        blockId: "b2",
        embedding: new Float32Array([4, 5, 6]),
        // no metadata for this one
      },
    ]);

    const bytes = idx.serializeToArrow();
    const restored = MemVectorIndex.deserializeFromArrow(info, bytes);

    const blocks: Array<{ blockId: string; metadata?: unknown }> = [];
    for await (const b of restored.getDocumentsBlocks()) {
      blocks.push({ blockId: b.blockId, metadata: b.metadata });
    }
    blocks.sort((a, b) => a.blockId.localeCompare(b.blockId));

    expect(blocks[0]?.metadata).toEqual({ kind: "doc", weight: 7 });
    expect(blocks[1]?.metadata).toBeUndefined();
  });
});
