import { newFullTextAccess } from "@statewalker/indexer-fulltext";
import {
  collect,
  runKernelConformanceSuite,
  runMultiInstanceConformanceSuite,
  runVectorConformanceSuite,
} from "@statewalker/indexer-tests";
import { newVectorAccess, type VectorProvider } from "@statewalker/indexer-vector";
import { describe, expect, it } from "vitest";
import {
  createSqliteIndexer,
  newSqliteFullTextProvider,
  newSqliteVectorProvider,
} from "../src/index.js";
import { asModalityProvider } from "./support/as-modality-provider.js";
import { flavours, indexerFactory } from "./support/dbs.js";

const vec = (...xs: number[]) => Float32Array.from(xs);

for (const flavour of flavours) {
  const label = `SQLite (${flavour.name})`;
  const factory = indexerFactory(flavour, () => [
    newSqliteFullTextProvider(),
    newSqliteVectorProvider(),
  ]);

  runVectorConformanceSuite(
    label,
    asModalityProvider(newSqliteVectorProvider(), flavour.open) as VectorProvider,
    { config: { dimensionality: 3, model: "test" } },
  );

  runKernelConformanceSuite(label, {
    factory,
    primaryConfig: { type: "fulltext", language: "en" },
    secondaryConfig: { type: "vector", dimensionality: 3, model: "test" },
  });

  runMultiInstanceConformanceSuite(label, {
    factory,
    fullText: {
      configs: [
        () => ({ type: "fulltext", language: "en" }),
        () => ({ type: "fulltext", language: "fr" }),
      ],
      ingest: async (index, name, block) => newFullTextAccess(name).get(index).addDocument([block]),
      buildQuery: (query: string) => ({ queries: [query] }),
    },
    vector: {
      configs: [
        () => ({ type: "vector", dimensionality: 3, model: "model-a" }),
        () => ({ type: "vector", dimensionality: 3, model: "model-b" }),
      ],
      ingest: async (index, name, block) => newVectorAccess(name).get(index).addDocument([block]),
      buildQuery: (embedding: Float32Array) => ({ embeddings: [embedding] }),
    },
  });

  describe(`${label} — vector specifics`, () => {
    async function open() {
      const db = await flavour.open();
      const indexer = await createSqliteIndexer({ db, providers: [newSqliteVectorProvider()] });
      const index = await indexer.createIndex({
        name: "t",
        subIndexes: { v: { type: "vector", dimensionality: 3, model: "m" } },
      });
      return { db, indexer, sub: newVectorAccess("v").get(index) };
    }

    it("re-adding a block replaces its vector", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", embedding: vec(1, 0, 0) }]);
      await sub.addDocument([{ path: "/d/1", blockId: "b", embedding: vec(0, 1, 0) }]);
      expect(await sub.getSize()).toBe(1);
      const [hit] = await collect(sub.search({ embeddings: [vec(0, 1, 0)], topK: 1 }));
      expect(hit?.score).toBeCloseTo(1, 1);
    });

    it("scopes by path prefix", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/a/1", blockId: "x", embedding: vec(1, 0, 0) }]);
      await sub.addDocument([{ path: "/b/1", blockId: "y", embedding: vec(1, 0, 0) }]);
      const hits = await collect(sub.search({ embeddings: [vec(1, 0, 0)], paths: ["/b"] }));
      expect(hits.map((h) => h.blockId)).toEqual(["y"]);
    });

    it("rejects a vector of the wrong dimensionality", async () => {
      const { sub } = await open();
      await expect(
        sub.addDocument([{ path: "/d/1", blockId: "b", embedding: vec(1, 0) }]),
      ).rejects.toThrow("Expected dimensionality 3, got 2");
    });

    it("getDocumentsBlocks returns the stored embeddings", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", embedding: vec(0.6, 0.8, 0) }]);
      const [block] = await collect(sub.getDocumentsBlocks());
      // Stored as the engine keeps it: normalised for cosine (this one is already unit length).
      const got = Array.from(block?.embedding ?? []);
      [0.6, 0.8, 0].forEach((x, i) => {
        expect(got[i]).toBeCloseTo(x, 5);
      });
    });

    it("a new indexer on the same Db searches the old vectors", async () => {
      const { db, indexer, sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", embedding: vec(1, 0, 0) }]);
      await indexer.close();
      const again = await createSqliteIndexer({ db, providers: [newSqliteVectorProvider()] });
      const index = await again.getIndex("t");
      const hits = await collect(
        newVectorAccess("v")
          .get(index as NonNullable<typeof index>)
          .search({ embeddings: [vec(1, 0, 0)] }),
      );
      expect(hits.map((h) => h.blockId)).toEqual(["b"]);
    });
  });
}
