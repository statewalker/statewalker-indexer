// =============================================================================
// Multi-instance conformance suite — multiple sub-indexes of the same modality
// type on one Index.
//
// Covers the use cases that motivated the open-registry pivot:
//   - Two FTS sub-indexes with different "languages" (or any per-instance
//     config variation) on the same Index.
//   - Two vector sub-indexes with different "models" (or different
//     dimensionalities) on the same Index.
//   - Mixed: one FTS + two vectors.
//
// The suite is parameterised by a `factory` and the modality-specific
// `addContent` / `buildQuery` callbacks for each modality the backend
// supports. Each scenario is gated on the relevant callback being supplied,
// so backends opt in only to the scenarios their Provider set can run.
// =============================================================================

import type { DocumentPath, Index, ScoredHit, SearchRequest } from "@statewalker/indexer-api";
import { getSubResult } from "@statewalker/indexer-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collect } from "./test-utils.js";
import type { IndexerFactory } from "./types.js";

/** Either a Record-shape config or a function building one (used to vary configs). */
export type ConfigFactory = () => { type: string } & Record<string, unknown>;

export interface FullTextModalityHooks {
  /**
   * Provide two distinct full-text configs (e.g. one English, one French) that
   * the backend's FTS Provider can both consume.
   */
  configs: [ConfigFactory, ConfigFactory];
  /**
   * Ingest a block into the FTS sub-index registered under `name`. The
   * implementation must read the binding from `index.getBinding(name)` and
   * call its `index.addDocument`.
   */
  ingest(
    index: Index,
    name: string,
    block: { path: DocumentPath; blockId: string; content: string },
  ): Promise<void>;
  /** Build the FTS sub-query payload for a textual query. */
  buildQuery(query: string): unknown;
}

export interface VectorModalityHooks {
  /** Provide two distinct vector configs (e.g. different models / dims). */
  configs: [ConfigFactory, ConfigFactory];
  /** Ingest a block into the vector sub-index registered under `name`. */
  ingest(
    index: Index,
    name: string,
    block: { path: DocumentPath; blockId: string; embedding: Float32Array },
  ): Promise<void>;
  /** Build the vector sub-query payload for a given embedding. */
  buildQuery(embedding: Float32Array): unknown;
}

export interface MultiInstanceSuiteOptions {
  factory: IndexerFactory;
  fullText?: FullTextModalityHooks;
  vector?: VectorModalityHooks;
}

export function runMultiInstanceConformanceSuite(
  name: string,
  options: MultiInstanceSuiteOptions,
): void {
  const { factory, fullText, vector } = options;

  describe(`${name} — multi-instance scenarios`, () => {
    let indexer: Awaited<ReturnType<typeof factory.create>>;

    beforeEach(async () => {
      indexer = await factory.create();
    });

    afterEach(async () => {
      try {
        await indexer.close();
      } catch {
        /* */
      }
      await factory.cleanup?.();
    });

    if (fullText) {
      const ft = fullText;
      it("two FTS sub-indexes coexist on one Index, each addressed by name", async () => {
        const [cfgA, cfgB] = ft.configs;
        const index = await indexer.createIndex({
          name: "two-fts",
          subIndexes: { q_en: cfgA(), q_fr: cfgB() },
        });
        // Different content per sub-index; the same query targets only one.
        await ft.ingest(index, "q_en", { path: "/d/1", blockId: "en1", content: "hello world" });
        await ft.ingest(index, "q_fr", { path: "/d/2", blockId: "fr1", content: "bonjour monde" });
        await indexer.flush();

        // Query the EN sub-index only.
        const enResults = await collect(
          index.search({
            topK: 10,
            subQueries: { q_en: ft.buildQuery("hello") },
          } satisfies SearchRequest),
        );
        const enIds = enResults.map((r) => r.blockId);
        expect(enIds).toContain("en1");
        expect(enIds).not.toContain("fr1");

        // Query the FR sub-index only.
        const frResults = await collect(
          index.search({
            topK: 10,
            subQueries: { q_fr: ft.buildQuery("bonjour") },
          } satisfies SearchRequest),
        );
        const frIds = frResults.map((r) => r.blockId);
        expect(frIds).toContain("fr1");
        expect(frIds).not.toContain("en1");
      });
    }

    if (vector) {
      const v = vector;
      it("two vector sub-indexes coexist on one Index, each addressed by name", async () => {
        const [cfgA, cfgB] = v.configs;
        const aCfg = cfgA();
        const bCfg = cfgB();
        const index = await indexer.createIndex({
          name: "two-vec",
          subIndexes: { v1: aCfg, v2: bCfg },
        });
        const dimA = Number(aCfg.dimensionality);
        const dimB = Number(bCfg.dimensionality);
        const vecA = Float32Array.from(Array.from({ length: dimA }, (_, i) => (i === 0 ? 1 : 0)));
        const vecB = Float32Array.from(Array.from({ length: dimB }, (_, i) => (i === 0 ? 1 : 0)));
        await v.ingest(index, "v1", { path: "/d/1", blockId: "a", embedding: vecA });
        await v.ingest(index, "v2", { path: "/d/2", blockId: "b", embedding: vecB });
        await indexer.flush();

        const r1 = await collect(
          index.search({
            topK: 10,
            subQueries: { v1: v.buildQuery(vecA) },
          } satisfies SearchRequest),
        );
        const ids1 = r1.map((r) => r.blockId);
        expect(ids1).toContain("a");
        expect(ids1).not.toContain("b");

        const r2 = await collect(
          index.search({
            topK: 10,
            subQueries: { v2: v.buildQuery(vecB) },
          } satisfies SearchRequest),
        );
        const ids2 = r2.map((r) => r.blockId);
        expect(ids2).toContain("b");
        expect(ids2).not.toContain("a");
      });
    }

    if (fullText && vector) {
      const ft = fullText;
      const v = vector;
      it("one FTS + two vectors fuse via RRF when all three names are queried", async () => {
        const [vCfgA, vCfgB] = v.configs;
        const aCfg = vCfgA();
        const bCfg = vCfgB();
        const ftCfg = ft.configs[0]();
        const index = await indexer.createIndex({
          name: "mixed",
          subIndexes: { q: ftCfg, v1: aCfg, v2: bCfg },
        });
        const dimA = Number(aCfg.dimensionality);
        const dimB = Number(bCfg.dimensionality);
        const vecA = Float32Array.from(Array.from({ length: dimA }, (_, i) => (i === 0 ? 1 : 0)));
        const vecB = Float32Array.from(Array.from({ length: dimB }, (_, i) => (i === 0 ? 1 : 0)));
        await ft.ingest(index, "q", { path: "/d/1", blockId: "x", content: "alpha" });
        await v.ingest(index, "v1", { path: "/d/1", blockId: "x", embedding: vecA });
        await v.ingest(index, "v2", { path: "/d/1", blockId: "x", embedding: vecB });
        await indexer.flush();

        const results = await collect(
          index.search({
            topK: 10,
            subQueries: {
              q: ft.buildQuery("alpha"),
              v1: v.buildQuery(vecA),
              v2: v.buildQuery(vecB),
            },
          } satisfies SearchRequest),
        );
        expect(results.length).toBeGreaterThan(0);
        // The lone block "x" should appear and carry three sub-results.
        const first = results.find((r) => r.blockId === "x");
        if (!first) throw new Error("expected block 'x' in results");
        expect(getSubResult<ScoredHit>(first, "q")).toBeDefined();
        expect(getSubResult<ScoredHit>(first, "v1")).toBeDefined();
        expect(getSubResult<ScoredHit>(first, "v2")).toBeDefined();
      });
    }
  });
}
