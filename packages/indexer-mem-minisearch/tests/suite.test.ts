// =============================================================================
// MiniSearch + MemVector conformance — wires the backend's Provider set into
// the kernel, per-modality, RRF-blending, and multi-instance suites from
// `@statewalker/indexer-tests`.
// =============================================================================

import type { Index } from "@statewalker/indexer-api";
import type { FulltextQuery } from "@statewalker/indexer-fulltext";
import { newFullTextAccess } from "@statewalker/indexer-fulltext";
import { memVectorProvider } from "@statewalker/indexer-mem";
import {
  runFullTextConformanceSuite,
  runFullTextMultiWordSuite,
  runKernelConformanceSuite,
  runMultiInstanceConformanceSuite,
  runRrfBlendingSuite,
  runVectorConformanceSuite,
} from "@statewalker/indexer-tests";
import type { VectorQuery } from "@statewalker/indexer-vector";
import { newVectorAccess } from "@statewalker/indexer-vector";
import { createMiniSearchIndexer } from "../src/minisearch-indexer.js";
import { miniSearchFullTextProvider } from "../src/minisearch-provider.js";

const factory = {
  create: async () => createMiniSearchIndexer(),
  createWithPersistence: async (
    persistence: Parameters<typeof createMiniSearchIndexer>[0] extends infer T
      ? T extends { persistence?: infer P }
        ? P
        : never
      : never,
  ) => createMiniSearchIndexer({ persistence }),
};

const ftConfig = { type: "fulltext" as const, language: "en" };
const vecConfig = { type: "vector" as const, dimensionality: 3, model: "test" };

runKernelConformanceSuite("MiniSearch + MemVector", {
  factory,
  primaryConfig: ftConfig,
  secondaryConfig: vecConfig,
});

runFullTextConformanceSuite("MiniSearch FTS", miniSearchFullTextProvider, {
  config: { language: "en" },
});
runVectorConformanceSuite("MemVector (under MiniSearch backend)", memVectorProvider, {
  config: { dimensionality: 3, model: "test" },
});

const ftAccess = newFullTextAccess("q");
runRrfBlendingSuite("MiniSearch FTS", {
  factory,
  config: ftConfig,
  populate: async (index: Index) => {
    const sub = ftAccess.get(index);
    await sub.addDocument([{ path: "/d/a", blockId: "a", content: "alpha alpha alpha" }]);
    await sub.addDocument([{ path: "/d/b", blockId: "b", content: "alpha beta" }]);
    await sub.addDocument([{ path: "/d/c", blockId: "c", content: "alpha gamma" }]);
  },
  buildQuery: ({ topK }) =>
    ({
      queries: ["alpha"],
      ...(topK !== undefined ? { topK } : {}),
    }) satisfies FulltextQuery,
});

// Cross-backend multi-word FTS contract (partial match, coverage-ranked).
runFullTextMultiWordSuite("MiniSearch FTS", { factory, config: ftConfig });

runMultiInstanceConformanceSuite("MiniSearch + MemVector", {
  factory,
  fullText: {
    configs: [
      () => ({ type: "fulltext", language: "en" }),
      () => ({ type: "fulltext", language: "fr" }),
    ],
    ingest: async (index, name, block) => {
      const access = newFullTextAccess(name);
      await access.get(index).addDocument([block]);
    },
    buildQuery: (query: string) => ({ queries: [query] }) satisfies FulltextQuery,
  },
  vector: {
    configs: [
      () => ({ type: "vector", dimensionality: 3, model: "model-a" }),
      () => ({ type: "vector", dimensionality: 3, model: "model-b" }),
    ],
    ingest: async (index, name, block) => {
      const access = newVectorAccess(name);
      await access.get(index).addDocument([block]);
    },
    buildQuery: (embedding: Float32Array) => ({ embeddings: [embedding] }) satisfies VectorQuery,
  },
});
