// Conformance suites for the open-sub-index-registry contract.
//
// Backends import only the suites they need; each suite is self-contained and
// parameterised on the factories / Providers / hooks the backend can supply.

export type { FullTextSuiteOptions } from "./conformance/fulltext.suite.js";
export { runFullTextConformanceSuite } from "./conformance/fulltext.suite.js";

export type {
  KernelSuiteOptions,
  SubIndexConfig,
} from "./conformance/kernel.suite.js";
export {
  MemoryPersistence,
  runKernelConformanceSuite,
} from "./conformance/kernel.suite.js";

export type {
  ConfigFactory,
  FullTextModalityHooks,
  MultiInstanceSuiteOptions,
  VectorModalityHooks,
} from "./conformance/multi-instance.suite.js";
export { runMultiInstanceConformanceSuite } from "./conformance/multi-instance.suite.js";

export type { RrfSuiteOptions } from "./conformance/rrf-blending.suite.js";
export { runRrfBlendingSuite } from "./conformance/rrf-blending.suite.js";

export { collect, defined } from "./conformance/test-utils.js";

export type { IndexerFactory } from "./conformance/types.js";

export type { VectorSuiteOptions } from "./conformance/vector.suite.js";
export { runVectorConformanceSuite } from "./conformance/vector.suite.js";

// Fixtures (markdown docs, queries, pre-computed embeddings) remain on disk
// under `./fixtures/` for any future per-modality suite that wants them, but
// are not re-exported as a public surface — the new conformance suites are
// self-contained and the fixture loader uses Node APIs that the package
// otherwise avoids depending on.
