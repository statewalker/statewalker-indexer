# Open registry of named sub-indexes replaces the fixed FTS+vector composite

## Status

accepted (revised 2026-05-28 after the multi-instance grilling session)

## Context and decision

The original indexer contract was hardwired to exactly two modalities. Every `Index` was a composite of an optional `FullTextIndex` and an optional `EmbeddingIndex`, with `HybridSearchParams` / `HybridSearchResult` naming, `HybridWeights = { fts, embedding }`, and an `IndexedBlock` carrying optional `content` + `embedding`. Adding a third modality (graph, semantic, …) meant editing the kernel and every consumer. The contract also implicitly assumed **one sub-index per modality** — a single Index could not host both an English and a French full-text sub-index, or both a content-vector and a meta-summary-vector sub-index over the same dataset.

We are reshaping the contract so an `Index` is an **open registry of named sub-indexes**. Each sub-index has:

- A user-chosen **name** (`"q"`, `"q_fr"`, `"semantic"`, `"semantic_meta"`), unique within its parent Index.
- A **modality type** (`"fulltext"`, `"vector"`, `"graph"`, …), carried in the sub-index's config under the `type` field.
- A typed config (`FullTextConfig`, `VectorConfig`, …) interpreted by the matching **modality provider**.

Multiple sub-indexes of the same modality type can coexist on one Index. The Index holds an enumerable `Map<name, SubIndexBinding>`; each binding is the slim `{ name, type, config, index }` 4-tuple.

Consequently:

- **`Index` keeps only blending + lifecycle + registry**: `search`, `deleteDocuments`, `flush`, `close`, `deleteIndex`, plus `setBinding` / `getBinding` / `getBindings`. Ingestion (`addDocument`) and enumeration (`getSize`, `getDocumentPaths`, …) live on each sub-index. There is no top-level "indexed block" type.
- **Blending is parameter-free RRF only**, generalised to N streams. The top-level `SearchResult.score` is always the RRF fusion position; modality-native magnitude (BM25, cosine) lives only on the sub-result. Weighted blending moves to caller-side reranking in `@statewalker/indexer-search`.
- **Sub-queries and sub-results are addressed by sub-index name**, not by modality key. The kernel exposes generic helpers `getSubQuery<Q>(request, name)`, `setSubQuery<Q>(request, name, q)`, `getSubResult<R>(result, name)`, `setSubResult<R>(result, name, r)`. `SearchRequest.subQueries` and `SearchResult.subResults` are nested `Record<string, unknown>` maps to avoid colliding with top-level fields.
- **Modality packages** (`@statewalker/indexer-fulltext`, `@statewalker/indexer-vector`) own per-modality types (`FullTextIndex`, `FullTextBlock`, `FulltextQuery`, `FulltextResult`, …), a typed **Provider** interface (`FullTextProvider { type: "fulltext"; create(config): FullTextIndex }`), a typed **Config helper** (`setFullTextConfig(params, name, config)`), and a user-facing **Access handle** factory (`newFullTextAccess(name)`). They do **not** export per-modality binding helpers or adapter triples — those concepts are retired.
- **Per-modality sub-indexes opt into persistence** via the `PersistableSearchIndex` interface (`serialise(): AsyncIterable<PersistenceEntry>` + `loadFrom(entries): Promise<void>`). The composite Index orchestrates save/load by iterating registered sub-indexes; non-persistable modalities are skipped.
- **Per-Index manifest** is the first persistence entry written for each Index. It mirrors `CreateIndexParams.subIndexes` exactly — `{ name, subIndexes: Record<name, { type, ...config }> }` — and is the saved form of the create payload.
- **Per-sub-index load actions** at `Indexer.getIndex(name, options)`: `adopt` (default), `reinit` (with optional new config), `skip`. Plus `onMissingProvider: "throw" | "warn"` for when a saved sub-index has no matching runtime Provider.
- **`indexer-core` keeps the persistence-backed factory builder** (modality-agnostic over a `providers: ModalityProvider[]` set); the SQL-backed factory builder is **deleted**. Each SQL backend (`indexer-duckdb`, `indexer-pglite`) inlines its own Indexer impl using shared SQL helpers (`createSqlFtsRetriever`, `createSqlVectorRetriever`, `SqlDb`, `buildPathPrefixSql`, `sanitizePrefix`). The shared-docs-table-with-FK pattern is specific to those backends and doesn't generalise cleanly behind a Provider abstraction.

See [`CONTEXT.md`](../../CONTEXT.md) for the resolved vocabulary.

## Considered options

- **Per-modality key-bound adapter pairs** (rejected after the multi-instance discussion) — the original `newSubIndex<I>("fulltext")` / `newSubQuery<Q>("fulltext")` / `newSubResult<R>("fulltext")` pattern bound accessors to a single stable string per modality. It made "one English FTS and one French FTS in the same Index" impossible without inventing per-language keys at the kernel level. Replaced by name-parametric kernel helpers + per-name **Access handles** from the modality packages.
- **Reuse `shared-adapters.newAdapter`** (rejected at the original grilling) — its parent-chain inheritance is for ambient context objects; sub-queries / sub-results have no parent chain, and the lookup walk is dead weight that would silently inherit across unrelated objects.
- **Global sub-index-kind registry** (rejected) — imports-order-sensitive global mutable state; lifecycle fan-out needs an enumerable collection on the `Index` regardless (`close()` has no request in scope), so the registry lives there.
- **Generalise `createSqlBackedIndexer` to N modalities via a heavy SQL Provider** (rejected) — would stretch one Provider abstraction across two genuinely different domains (memory bytes vs SQL tables with FK reclamation). Each SQL backend inlining its Indexer is the honest split.
- **Compatibility shims for the rename / shape change** (rejected) — every consumer is gitlinked and advances in one umbrella cascade; there is no independently-published consumer to protect, so we take a clean break.

## Consequences

- Breaking, non-incremental change across the `statewalker-indexer` repo, then `indexer-search`, `statewalker-content`, and `indexer.app`, landed before a single umbrella gitlink bump.
- `@statewalker/indexer-api` loses its "zero runtime" property: it now exports the four name-parametric helpers (`getSubQuery` / `setSubQuery` / `getSubResult` / `setSubResult`) and possibly base Provider / Persistable types. Modality *instances* live in the modality packages, so type-only consumers still pull only what they import.
- The implementation revision built before this re-grilling (kernel adapter triple, per-modality `register*` helpers, `SubIndexBinding` with closures, composite reading by adapter key) is **superseded**. The kernel + modality packages + composite rewrites under this ADR; see the OpenSpec change `open-sub-index-registry` for the revised tasks.
- `indexer.app` doc-scoring switches from the composite score to the FTS sub-result's native score — arguably a correctness fix, since it previously conflated fused and raw scores. The `SearchMode = "...|hybrid"` enum is retired in favour of the multi-name model.
