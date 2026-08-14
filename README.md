# statewalker-indexer

Indexing primitives: pluggable full-text and vector indexers (in-memory, DuckDB, PGlite).

## Packages

<!-- List every package under `packages/` here with a one-line description and a link. Kept in sync by `scripts/new-monorepo.ts` and audited by `scripts/validate-migration.ts`. -->

| Package | Description | Published |
| --- | --- | :---: |
| [@statewalker/indexer-api](packages/indexer-api) | Pluggable indexer contract: full-text, vector, hybrid. | yes |
| [@statewalker/indexer-chunker](packages/indexer-chunker) | Markdown-aware chunking utilities. | yes |
| [@statewalker/indexer-core](packages/indexer-core) | Workspace-internal scaffolding consumed by the backends (composite index, merge, SQL retrievers, generic factory builders). | no |
| [@statewalker/indexer-mem](packages/indexer-mem) | In-memory vector sub-index (`MemVectorIndex`) used by the FlexSearch/MiniSearch indexers. | yes |
| [@statewalker/indexer-mem-flexsearch](packages/indexer-mem-flexsearch) | FlexSearch + `MemVectorIndex` + optional persistence. | yes |
| [@statewalker/indexer-mem-minisearch](packages/indexer-mem-minisearch) | MiniSearch + `MemVectorIndex` + optional persistence. | yes |
| [@statewalker/indexer-duckdb](packages/indexer-duckdb) | DuckDB backend: real BM25 FTS (`fts` extension) + HNSW cosine vector (`vss` extension). | yes |
| [@statewalker/indexer-pglite](packages/indexer-pglite) | PGlite backend: `tsvector`/GIN FTS + `pgvector` HNSW cosine. | yes |
| [@statewalker/indexer-search](packages/indexer-search) | Workspace-internal app-side search-orchestration stack (SearchPipeline, embed helpers, reranker blending, mocks). QMD-port utilities live under `./utils`. | no |
| [@statewalker/indexer-tests](packages/indexer-tests) | Shared Vitest conformance suite run by every backend. | no |

## Cross-repo dependencies

This repository depends on:

| Repository | Packages used |
| --- | --- |
| [`statewalker-db`](https://github.com/statewalker/statewalker-db) | `@statewalker/db-api` |

**Depended on by:** [`sandclaw`](https://github.com/statewalker/sandclaw) (`@statewalker/indexer-api`, `@statewalker/indexer-fulltext`, `@statewalker/indexer-mem-flexsearch`, `@statewalker/indexer-vector`).

Cross-repo dependencies are declared `workspace:*` rather than `catalog:`. This is
deliberate: turbo derives its task graph from `workspace:` specifiers and does **not**
resolve `catalog:`, so a `catalog:` cross-repo dependency is invisible to the scheduler
and its consumer can be built before it.

## Development

```sh
pnpm install
pnpm run build
pnpm run test
```

## Release

Releases are managed via [changesets](https://github.com/changesets/changesets):

```sh
pnpm changeset           # describe the change
pnpm version-packages    # roll versions + regenerate CHANGELOGs
pnpm release-packages    # publish to npm
```
