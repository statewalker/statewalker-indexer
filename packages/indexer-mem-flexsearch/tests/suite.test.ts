// =============================================================================
// FlexSearch + MemVector conformance — wires the backend's Provider set into
// the kernel, per-modality, RRF-blending, and multi-instance suites from
// `@statewalker/indexer-tests`.
//
// The backend (`createFlexSearchIndexer`) bundles `flexSearchFullTextProvider`
// (fulltext) and `memVectorProvider` (vector); each suite is opted into based
// on which modalities the Providers cover.
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
import { createFlexSearchIndexer } from "../src/flexsearch-indexer.js";
import { flexSearchFullTextProvider } from "../src/flexsearch-provider.js";

const factory = {
  create: async () => createFlexSearchIndexer(),
  createWithPersistence: async (
    persistence: Parameters<typeof createFlexSearchIndexer>[0] extends infer T
      ? T extends { persistence?: infer P }
        ? P
        : never
      : never,
  ) => createFlexSearchIndexer({ persistence }),
};

const ftConfig = { type: "fulltext" as const, language: "en" };
const vecConfig = { type: "vector" as const, dimensionality: 3, model: "test" };

// Kernel suite — uses both modality types for manifest round-trip coverage.
runKernelConformanceSuite("FlexSearch + MemVector", {
  factory,
  primaryConfig: ftConfig,
  secondaryConfig: vecConfig,
});

// Per-modality suites — driven directly by the Providers.
runFullTextConformanceSuite("FlexSearch FTS", flexSearchFullTextProvider, {
  config: { language: "en" },
});
runVectorConformanceSuite("MemVector", memVectorProvider, {
  config: { dimensionality: 3, model: "test" },
});

// RRF + topK-override scenarios using a single FTS sub-index.
const ftAccess = newFullTextAccess("q");
runRrfBlendingSuite("FlexSearch FTS", {
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
runFullTextMultiWordSuite("FlexSearch FTS", { factory, config: ftConfig });

// Multi-instance scenarios — two FTS langs, two vectors, mixed.
runMultiInstanceConformanceSuite("FlexSearch + MemVector", {
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
