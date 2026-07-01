// =============================================================================
// Full-text per-modality conformance suite.
//
// Targets the `FullTextIndex` contract: ingestion, search (lex / phrase),
// enumeration, deletion, info, and (when the Provider produces a
// `PersistableSearchIndex`) the `serialise` / `loadFrom` round-trip.
//
// Suite consumers supply a `FullTextProvider` directly — there is no Indexer
// involved here. The suite exercises sub-index semantics in isolation.
// =============================================================================

import { isPersistable, type PersistenceEntry } from "@statewalker/indexer-api";
import type { FullTextConfig, FullTextProvider } from "@statewalker/indexer-fulltext";
import { describe, expect, it } from "vitest";
import { collect } from "./test-utils.js";

export interface FullTextSuiteOptions {
  /** A complete config the Provider accepts. */
  config: FullTextConfig;
}

export function runFullTextConformanceSuite(
  name: string,
  provider: FullTextProvider,
  options: FullTextSuiteOptions,
): void {
  const { config } = options;

  describe(`${name} — fulltext conformance`, () => {
    it("Provider.type is the canonical 'fulltext' discriminator", () => {
      expect(provider.type).toBe("fulltext");
    });

    it("create returns an index whose info reflects the config", async () => {
      const index = provider.create(config);
      const info = await index.getIndexInfo();
      expect(info.language).toBe(config.language);
    });

    it("addDocument + search round-trips a single block", async () => {
      const index = provider.create(config);
      await index.addDocument([{ path: "/d/1", blockId: "b1", content: "the quick brown fox" }]);
      const hits = await collect(index.search({ queries: ["fox"], topK: 10 }));
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.blockId).toBe("b1");
      expect(hits[0]?.path).toBe("/d/1");
      expect(hits[0]?.score).toBeGreaterThan(0);
    });

    it("a block matching more queries ranks above blocks matching fewer", async () => {
      // Contract (FulltextQuery.queries): "blocks matching more queries rank higher."
      // Disjoint vocabularies, so each query matches exactly its named blocks: the
      // multi-matcher hits all three queries, each single-matcher hits exactly one.
      const index = provider.create(config);
      await index.addDocument([
        { path: "/d/all", blockId: "all", content: "alpha beta gamma" },
        { path: "/d/a", blockId: "a", content: "alpha" },
        { path: "/d/b", blockId: "b", content: "beta" },
        { path: "/d/c", blockId: "c", content: "gamma" },
      ]);
      const hits = await collect(index.search({ queries: ["alpha", "beta", "gamma"], topK: 10 }));
      // The block matching all three queries must outrank every single-query match —
      // a max-merge (vs the required accumulation) buries it below them.
      expect(hits[0]?.blockId).toBe("all");
      const allScore = hits.find((h) => h.blockId === "all")?.score ?? 0;
      for (const id of ["a", "b", "c"]) {
        const score = hits.find((h) => h.blockId === id)?.score ?? 0;
        expect(allScore).toBeGreaterThan(score);
      }
    });

    it("a multi-word query matches sections covering only part of the term set", async () => {
      // A single query string carrying several terms must not require a section to contain
      // ALL of them: partial matches are returned, ranked by how much of the term set they
      // cover. (Otherwise long keyword probes collapse to empty, and tiny wording changes
      // flip the result set.) The section matching the most terms ranks first.
      const index = provider.create(config);
      await index.addDocument([
        { path: "/d/all", blockId: "all", content: "alpha beta gamma" },
        { path: "/d/two", blockId: "two", content: "alpha beta" },
        { path: "/d/one", blockId: "one", content: "alpha" },
      ]);
      const hits = await collect(index.search({ queries: ["alpha beta gamma"], topK: 10 }));
      expect(hits.map((h) => h.blockId)).toContain("one");
      expect(hits[0]?.blockId).toBe("all");
    });

    it("getSize and getDocumentPaths reflect ingestion", async () => {
      const index = provider.create(config);
      await index.addDocument([{ path: "/d/1", blockId: "b1", content: "alpha" }]);
      await index.addDocument([{ path: "/d/2", blockId: "b2", content: "beta" }]);
      expect(await index.getSize()).toBe(2);
      const paths = await collect(index.getDocumentPaths());
      expect(paths).toContain("/d/1");
      expect(paths).toContain("/d/2");
    });

    it("deleteDocuments removes by path selector", async () => {
      const index = provider.create(config);
      await index.addDocument([{ path: "/d/1", blockId: "b1", content: "alpha" }]);
      await index.addDocument([{ path: "/d/2", blockId: "b2", content: "alpha" }]);
      await index.deleteDocuments([{ path: "/d/1" }]);
      expect(await index.getSize()).toBe(1);
      const hits = await collect(index.search({ queries: ["alpha"], topK: 10 }));
      expect(hits.map((h) => h.blockId)).toEqual(["b2"]);
    });

    it("serialise / loadFrom round-trips when persistable", async () => {
      const index = provider.create(config);
      if (!isPersistable(index)) return; // optional opt-in
      await index.addDocument([{ path: "/d/1", blockId: "b1", content: "marker phrase" }]);
      await index.flush();

      const entries: PersistenceEntry[] = [];
      for await (const entry of index.serialise()) {
        // Drain content into a single Uint8Array buffer per entry.
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
      const hits = await collect(restored.search({ queries: ["marker"], topK: 10 }));
      expect(hits.map((h) => h.blockId)).toEqual(["b1"]);
    });
  });
}
