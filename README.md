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
| [@statewalker/indexer-tests](packages/indexer-tests) | Shared Vitest conformance suite run by every backend. | no |

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
