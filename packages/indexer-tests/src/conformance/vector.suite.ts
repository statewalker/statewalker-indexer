// =============================================================================
// Vector per-modality conformance suite.
//
// Targets the `VectorIndex` contract: ingestion, search (cosine), enumeration,
// deletion, info, and (when the Provider produces a `PersistableSearchIndex`)
// the `serialise` / `loadFrom` round-trip.
//
// Suite consumers supply a `VectorProvider` directly — no Indexer involved.
// =============================================================================

import { isPersistable, type PersistenceEntry } from "@statewalker/indexer-api";
import type { VectorConfig, VectorProvider } from "@statewalker/indexer-vector";
import { describe, expect, it } from "vitest";
import { collect } from "./test-utils.js";

export interface VectorSuiteOptions {
  /** A complete config the Provider accepts. */
  config: VectorConfig;
}

function unit(...components: number[]): Float32Array {
  return Float32Array.from(components);
}

export function runVectorConformanceSuite(
  name: string,
  provider: VectorProvider,
  options: VectorSuiteOptions,
): void {
  const { config } = options;

  describe(`${name} — vector conformance`, () => {
    it("Provider.type is the canonical 'vector' discriminator", () => {
      expect(provider.type).toBe("vector");
    });

    it("create returns an index whose info reflects the config", async () => {
      const index = provider.create(config);
      const info = await index.getIndexInfo();
      expect(info.dimensionality).toBe(config.dimensionality);
      expect(info.model).toBe(config.model);
    });

    it("addDocument + search round-trips a single block", async () => {
      const index = provider.create(config);
      const dim = config.dimensionality;
      const vec = unit(...Array.from({ length: dim }, (_, i) => (i === 0 ? 1 : 0)));
      await index.addDocument([{ path: "/d/1", blockId: "b1", embedding: vec }]);
      const hits = await collect(index.search({ embeddings: [vec], topK: 10 }));
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.blockId).toBe("b1");
      expect(hits[0]?.path).toBe("/d/1");
      expect(hits[0]?.score).toBeGreaterThan(0);
    });

    it("cosine ranks aligned vectors above orthogonal ones", async () => {
      const index = provider.create(config);
      const dim = config.dimensionality;
      if (dim < 2) return;
      const e0 = unit(...Array.from({ length: dim }, (_, i) => (i === 0 ? 1 : 0)));
      const e1 = unit(...Array.from({ length: dim }, (_, i) => (i === 1 ? 1 : 0)));
      await index.addDocument([{ path: "/d/1", blockId: "near", embedding: e0 }]);
      await index.addDocument([{ path: "/d/2", blockId: "far", embedding: e1 }]);
      const hits = await collect(index.search({ embeddings: [e0], topK: 10 }));
      expect(hits[0]?.blockId).toBe("near");
    });

    it("deleteDocuments removes by path selector", async () => {
      const index = provider.create(config);
      const dim = config.dimensionality;
      const v = unit(...Array.from({ length: dim }, (_, i) => (i === 0 ? 1 : 0)));
      await index.addDocument([{ path: "/d/1", blockId: "b1", embedding: v }]);
      await index.addDocument([{ path: "/d/2", blockId: "b2", embedding: v }]);
      await index.deleteDocuments([{ path: "/d/1" }]);
      expect(await index.getSize()).toBe(1);
    });

    it("serialise / loadFrom round-trips when persistable", async () => {
      const index = provider.create(config);
      if (!isPersistable(index)) return;
      const dim = config.dimensionality;
      const v = unit(...Array.from({ length: dim }, (_, i) => (i === 0 ? 1 : 0)));
      await index.addDocument([{ path: "/d/1", blockId: "b1", embedding: v }]);
      await index.flush();

      const entries: PersistenceEntry[] = [];
      for await (const entry of index.serialise()) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of entry.content) chunks.push(chunk);
        entries.push({
          name: entry.name,
          content: (async function* () {
            for (const chunk of chunks) yield chunk;
          })(),
        });
      }
      expect(entries.length).toBeGreaterThan(0);

      const restored = provider.create(config);
      if (!isPersistable(restored)) return;
      await restored.loadFrom(entries);
      const hits = await collect(restored.search({ embeddings: [v], topK: 10 }));
      expect(hits.map((h) => h.blockId)).toEqual(["b1"]);
    });
  });
}
