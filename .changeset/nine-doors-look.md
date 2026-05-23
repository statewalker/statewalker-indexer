---
---

Empty changeset — prune-indexer-dead-code refactor.

Internal cleanup only:
- `@statewalker/indexer-core` (workspace-internal): drop dead `fanOutSearch` / `mergeHybrid` / `buildRrfTrace` exports.
- `@statewalker/indexer-duckdb`, `@statewalker/indexer-pglite`: delete 4 unused sub-index factory files.
- `@statewalker/indexer-search`: demoted to `private: true` (no published surface change to react to). `SemanticIndex` collapsed to `embedAndAdd` / `embedAndSearch` helpers; QMD-port utilities (`parseStructuredQuery`, `extractIntentTerms`, …) relocated behind a secondary `./utils` sub-export.

No published packages have observable contract changes.
