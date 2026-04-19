# statewalker-indexer

Indexing primitives: pluggable full-text and vector indexers (in-memory, DuckDB, PGlite).

## Packages

<!-- List every package under `packages/` here with a one-line description and a link. Kept in sync by `scripts/new-monorepo.ts` and audited by `scripts/validate-migration.ts`. -->

| Package | Description |
| --- | --- |
| [@statewalker/indexer-api](packages/indexer-api) | Pluggable indexer contract: full-text, vector, hybrid. |
| [@statewalker/indexer-chunker](packages/indexer-chunker) | Token- and paragraph-aware chunking utilities. |
| [@statewalker/indexer-mem](packages/indexer-mem) | In-memory base scaffold for full-text indexers. |
| [@statewalker/indexer-mem-flexsearch](packages/indexer-mem-flexsearch) | FlexSearch-backed in-memory indexer. |
| [@statewalker/indexer-mem-minisearch](packages/indexer-mem-minisearch) | MiniSearch-backed in-memory indexer. |
| [@statewalker/indexer-duckdb](packages/indexer-duckdb) | DuckDB-backed hybrid FTS + vector indexer (via `@statewalker/db-api`). |
| [@statewalker/indexer-pglite](packages/indexer-pglite) | PGlite-backed in-browser Postgres indexer. |
| [@statewalker/indexer-tests](packages/indexer-tests) | Shared Vitest suite (internal, not published). |

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
