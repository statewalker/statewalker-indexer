# statewalker-search

Search building blocks published under `@statewalker/*`: a pluggable indexer contract, full-text, vector and n-gram (grep) modalities, indexers in memory, in DuckDB, in PGlite and in SQLite, Markdown chunking, and content extractors that turn PDF, DOCX, XLSX, HTML and Markdown files into text. Applications pick one backend, create named indexes, put documents into named sub-indexes, and search them together.

## The shape: a contract, three modalities, five backends

```
                          indexer-api              (kernel types + helpers)
                    /          |           \
       indexer-fulltext  indexer-vector  indexer-ngram   (modality types, access handles)
                    \          |           /
                          indexer-core             (composite index, RRF, indexer builders)
          /            |                 |                |               \
 indexer-mem   indexer-mem-flexsearch  indexer-duckdb  indexer-pglite  indexer-sqlite
 (vectors)     indexer-mem-minisearch  (createSqlIndexer + a dialect)  (own kernel, providers)

 Side packages: indexer-chunker, content-extractors   (no indexer dependency)
 Private:       indexer-search (SearchPipeline), indexer-tests (conformance suites)
```

| Package | What it gives you | npm |
| --- | --- | --- |
| [@statewalker/indexer-api](packages/indexer-api) | `Indexer`, `Index`, `SearchIndex`, `ModalityProvider` types; sub-query/sub-result helpers. | [npm](https://www.npmjs.com/package/@statewalker/indexer-api) |
| [@statewalker/indexer-fulltext](packages/indexer-fulltext) | Full-text types, `FullTextProvider`, `newFullTextAccess`, config helpers. | [npm](https://www.npmjs.com/package/@statewalker/indexer-fulltext) |
| [@statewalker/indexer-vector](packages/indexer-vector) | Vector types, `VectorProvider`, `newVectorAccess`, config helpers. | [npm](https://www.npmjs.com/package/@statewalker/indexer-vector) |
| [@statewalker/indexer-ngram](packages/indexer-ngram) | N-gram / regex (grep) types, `newNgramAccess`, config helpers, `grep`. | [npm](https://www.npmjs.com/package/@statewalker/indexer-ngram) |
| [@statewalker/indexer-core](packages/indexer-core) | Code for backend authors: composite index, RRF, persistence-backed and SQL indexer builders. | [npm](https://www.npmjs.com/package/@statewalker/indexer-core) |
| [@statewalker/indexer-mem](packages/indexer-mem) | In-memory vector sub-index (`MemVectorIndex`) and `memVectorProvider`. | [npm](https://www.npmjs.com/package/@statewalker/indexer-mem) |
| [@statewalker/indexer-mem-flexsearch](packages/indexer-mem-flexsearch) | In-memory indexer: FlexSearch full-text + in-memory vectors, optional persistence. | [npm](https://www.npmjs.com/package/@statewalker/indexer-mem-flexsearch) |
| [@statewalker/indexer-mem-minisearch](packages/indexer-mem-minisearch) | In-memory indexer: MiniSearch full-text + in-memory vectors, optional persistence. | [npm](https://www.npmjs.com/package/@statewalker/indexer-mem-minisearch) |
| [@statewalker/indexer-duckdb](packages/indexer-duckdb) | DuckDB indexer: BM25 full-text (`fts`) + HNSW vectors (`vss`). | [npm](https://www.npmjs.com/package/@statewalker/indexer-duckdb) |
| [@statewalker/indexer-pglite](packages/indexer-pglite) | PGlite indexer: `tsvector`/GIN full-text + pgvector HNSW. | [npm](https://www.npmjs.com/package/@statewalker/indexer-pglite) |
| [@statewalker/indexer-sqlite](packages/indexer-sqlite) | SQLite indexer: FTS5 full-text, vectors and n-gram/grep in one `Db` (Node, browser worker, Durable Object). | [npm](https://www.npmjs.com/package/@statewalker/indexer-sqlite) |
| [@statewalker/indexer-chunker](packages/indexer-chunker) | Markdown-aware chunking before indexing. | [npm](https://www.npmjs.com/package/@statewalker/indexer-chunker) |
| [@statewalker/content-extractors](packages/content-extractors) | Text extraction from PDF, DOCX, XLSX, HTML, Markdown, plain text. | [npm](https://www.npmjs.com/package/@statewalker/content-extractors) |
| [@statewalker/indexer-search](packages/indexer-search) | `SearchPipeline` (expand, embed, search, rerank, cite), `weightedBlend`, query parser. | private |
| [@statewalker/indexer-tests](packages/indexer-tests) | Vitest conformance suites that every backend runs. | private |

External `@statewalker` dependencies: `@statewalker/db-api` (runtime: `indexer-duckdb`, `indexer-pglite`, `indexer-sqlite`), `@statewalker/db-sqlite` and `@statewalker/db-sqlite-index` (runtime: `indexer-sqlite`), and in tests `@statewalker/db-duckdb-node`, `@statewalker/db-pglite`, `@statewalker/db-sqlite-node` and `@statewalker/db-sqlite-do`.

## How to run it

1. Install Node.js 24 and enable corepack: `corepack enable`. pnpm 10 is pinned in `packageManager`.
2. Install: `pnpm install`.
3. Build all packages: `pnpm build`. Tests and typechecks of a package use the built `dist/` of its dependencies, so build first.
4. Test: `pnpm test`. Type-check: `pnpm typecheck`.
5. Before pushing: `pnpm lint:check` and `pnpm format:check` (or `pnpm lint` / `pnpm format` to fix).

For one package: `pnpm --filter @statewalker/<name> <script>`.

## Why it is the way it is

- **Sub-indexes are named, not keyed by modality.** One index can hold two full-text sub-indexes (English and French) or two vector sub-indexes (content and summaries). Queries and results are addressed by sub-index name, so the kernel never needs to know modality types; a new modality is a new package.
- **`Index.search` fuses with parameter-free RRF.** BM25 and cosine scores are not comparable, so the top-level `score` is a rank-fusion score. The native score of each sub-index stays on `result.subResults[name]`. Weighted blending is a caller-side step (`weightedBlend` in `indexer-search`).
- **Persistence is per sub-index.** A sub-index that can save itself implements `serialise()` / `loadFrom()`. The in-memory backends save through an `IndexerPersistence` port; the SQL backends store everything in their database.
- **DuckDB and PGlite share one indexer builder** (`createSqlIndexer` in `indexer-core`) because they share a per-index docs table that maps paths to row ids; the in-memory backends use the provider-based `createPersistenceBackedIndexer`. `indexer-sqlite` has its own kernel with one provider per modality, because its vector and n-gram engines index integer ids from a per-index blocks table and each create their own tables; it reuses the composite index and RRF from `indexer-core`.
- **Packages ship `dist/` and `src/`.** `exports` point at `dist/`; the sources are included for reading and debugging.

## What will surprise you

- **`SearchRequest.paths` does not filter.** The composite passes only each sub-query to its sub-index; the top-level `paths` is not forwarded. Put `paths` on each sub-query (`{ queries, paths }` / `{ embeddings, paths }` / `{ pattern, paths }`), or you get hits from the whole index.
- **Top-level `topK` only truncates the fused list.** Each sub-index retrieves `sub-query.topK` hits (default 100 in all current backends), then RRF fuses them.
- **DuckDB downloads extensions.** `createDuckDbIndexer` runs `INSTALL fts; INSTALL vss;`. Offline or sandboxed hosts fail at init with DuckDB's extension download error.
- **Several full-text `queries` combine differently per backend.** SQLite, FlexSearch and MiniSearch add up the per-query scores; DuckDB and PGlite keep each block's best one. The same request can rank blocks differently on different backends.
- **PGlite rejects unknown languages** with `pglite FTS: unsupported language "<x>" (must be an ISO-639-1 code or a Postgres text-search config name)`.
- **`language` does nothing in the in-memory full-text indexes.** FlexSearch and MiniSearch run without stemming; the value is only stored. SQLite stems only for exactly `"en"` (Porter); every other value, `"en-US"` included, gets no stemming and never throws.
- **A `for await` over an n-gram sub-index hides truncation.** Its search reports `truncated` only as the generator's return value; call `grep` from `indexer-ngram` to read it.

## Reference

### Commands

| Command | Does |
| --- | --- |
| `pnpm build` | `pnpm -r run build` (tsdown, writes `dist/`) |
| `pnpm test` | Vitest in every package under `packages/` |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm lint` / `pnpm lint:check` | Biome check with / without writes |
| `pnpm format` / `pnpm format:check` | Biome format with / without writes |
| `pnpm changeset` | Add a changeset (bump level and changelog text) |

### Releases

Packages are published to npm from CI with changesets. After CI passes on `main`, changesets are generated for packages whose packed contents differ from npm, and a "chore: version packages" pull request is opened; merging it publishes with npm provenance. Run `pnpm changeset` in your pull request to choose the bump or the changelog text yourself. Dependency updates arrive as Renovate pull requests.

### Files

| Path | Contents |
| --- | --- |
| `packages/*` | Workspace packages |
| `pnpm-workspace.yaml` | Workspace globs and the dependency catalog |
| `biome.json` | Lint and format rules |
| `turbo.json` | Task graph |
| `CONTEXT.md` | Vocabulary of the indexer contract |

## License

MIT. See [LICENSE](LICENSE).
