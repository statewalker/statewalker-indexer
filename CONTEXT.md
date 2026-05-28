# Indexer

Backend-agnostic contract for composing **multiple named sub-indexes** of arbitrary modality (full-text, vector, graph, …) into a single composite index that blends results across them. Multiple sub-indexes of the *same* modality are supported — e.g. two full-text sub-indexes for English and French, or two vector sub-indexes for content and meta-summaries.

## Language

**Indexer**:
Top-level registry/factory that creates, opens, lists, and deletes named **Indexes**. One per backend deployment. Wired with a set of **Modality providers** at construction time.
_Avoid_: SearchService, IndexRegistry

**Index**:
A named, persistent composite of zero or more **Sub-indexes** plus blending logic. Owns top-level `search`, `deleteDocuments`, lifecycle (`flush`, `close`, `deleteIndex`), and the registry of sub-index bindings. Does **not** own ingestion or enumeration — those live on each **Sub-index**.
_Avoid_: HybridIndex, CompositeIndex, SearchIndex

**Sub-index**:
A named instance of a search modality registered on an **Index** at create time. Each sub-index has a user-chosen **Sub-index name** (unique within its parent Index), a **Modality type**, and a typed config. Multiple sub-indexes of the same modality type can coexist on one Index. Owns its own ingestion, enumeration, modality-specific search, and (optionally) self-serialisation.
_Avoid_: Backend, Engine, Modality

**Sub-index name**:
A user-chosen string identifier (e.g. `"q"`, `"q_fr"`, `"semantic"`, `"semantic_meta"`) used to address one specific sub-index within its parent **Index**. Unique per Index, scoped to that Index only. Distinct from the **Modality type** — many sub-indexes can share a type but each has its own name.
_Avoid_: SubIndexKey, ChannelId

**Modality type**:
A string identifier for the kind of search a sub-index performs — `"fulltext"`, `"vector"`, `"graph"`, … Travels in each sub-index's config under the `type` field and is used by the **Indexer** to look up the matching **Modality provider** at create or load time.
_Avoid_: Kind, Family, Modality (overloaded)

**Modality provider**:
A typed factory bound to one **Modality type**, owned by a backend, that knows how to construct a sub-index instance from a typed config. Backends register one provider per modality type they support, at **Indexer** construction time. Distinct from the **Access handle**: providers are backend-facing (construction); accesses are user-facing (read/write).
_Avoid_: ModalityFactory, Builder

**Access handle**:
A user-side typed bundle bound to one **Sub-index name**, returned by a modality package's `newFullTextAccess(name)` / `newVectorAccess(name)` factory. Exposes typed read/write for the sub-index, its config, sub-query, and sub-result — all keyed by the bound name. `get(index)` throws if no sub-index by that name is registered; `tryGet(index)` returns `undefined` for probing. The handle does not know about **Modality providers** or persistence.
_Avoid_: SubIndexAdapter (the obsolete kernel-key pattern; see Flagged ambiguities)

**Sub-index binding**:
The unit an **Index** stores per sub-index: `{ name, type, config, index }`. The Index's binding map is enumerable, so lifecycle fan-out and search dispatch iterate it. Config travels on the binding so save can round-trip it through the **Index manifest**.

**Sub-query**:
A modality-specific search payload attached to a **SearchRequest** under a **Sub-index name** (not a modality key). Shape is determined by the modality type registered under that name — e.g. for a name `"q"` of type `"fulltext"`, the sub-query is a `FulltextQuery`. Presence of a sub-query for a name is what activates that sub-index during search.
_Avoid_: SubParams, ModalityQuery

**Sub-result**:
A modality-specific result payload attached to a **SearchResult** under a **Sub-index name**, symmetric with **Sub-query**. Every sub-index that contributed to the result writes its hit under its own name; absent names mean that sub-index did not match.
_Avoid_: SubHit, PartialResult

**SearchRequest**:
Top-level input to `Index.search`. Carries `paths`, `topK`, and `subQueries: Record<name, unknown>` mapping each active sub-index name to its sub-query. No blending weights — `Index.search` blends with parameter-free RRF; weighted blending is a caller-side rerank in `@statewalker/indexer-search`.

**SearchResult**:
Top-level output of `Index.search`. Carries `{path, blockId, score}` plus `subResults: Record<name, unknown>` mapping each contributing sub-index name to its native hit.

**Block**:
The unit of content held inside a **Sub-index**. Each sub-index defines its own block type (`FullTextBlock`, `VectorBlock`, future `GraphEdgeBlock`, …); there is no composite "indexed block" at the top level.

**DocumentPath**:
Hierarchical key (`/${string}`) identifying a document across all sub-indexes. The one identifier that crosses modality boundaries.

**Score** (two distinct kinds):
- *Fusion score* — the top-level `SearchResult.score`. Always the RRF rank-fusion position across whatever sub-indexes were active. Comparable only within one search; not a modality-native magnitude.
- *Native score* — the score on a **Sub-result** (BM25 for FTS, cosine for vector). The only place modality-native magnitude lives. Consumers wanting raw relevance read it here, never off the top-level result.

**Persistable sub-index**:
A **Sub-index** that opts into persistence by implementing the `PersistableSearchIndex` interface — `serialise(): AsyncIterable<PersistenceEntry>` and `loadFrom(entries: Iterable<PersistenceEntry>): Promise<void>`. Persistence does not flow through the factory or the composite; the **Index** orchestrates by iterating registered sub-indexes and delegating to each persistable one. Non-persistable sub-indexes (e.g. live RPC-backed) are simply skipped at save and load.

**Index manifest**:
The first persistence entry written for an **Index**. Records the set of `(name, config)` pairs registered on the index at save time — i.e. the saved form of `CreateIndexParams.subIndexes`. On load, this is read first; the runtime walks the manifest and applies per-name load actions (adopt / reinit / skip). After the manifest, each persistable sub-index writes its own state under namespaced entries.

**Load action**:
Per-sub-index policy at `Indexer.getIndex(name, options)` time: `"adopt"` (default — Provider builds from saved config, persistable sub-indexes load saved bytes), `"reinit"` (Provider builds, saved bytes discarded — optionally with a new config), or `"skip"` (sub-index not registered on the loaded Index; saved bytes preserved on disk). Distinct from `onMissingProvider` (the policy for when a saved sub-index has no matching runtime Provider — `"throw"` or `"warn"`).

## Relationships

- An **Indexer** owns many **Indexes** by name and is configured with a set of **Modality providers** keyed by **Modality type**.
- An **Index** owns zero or more **Sub-indexes**, each registered under a distinct **Sub-index name**.
- A **Sub-index** is built by the **Modality provider** matching its **Modality type** at create or load time.
- A **SearchRequest** contains zero or more **Sub-queries** under specific **Sub-index names**; an **Index** activates only the sub-indexes whose name is present.
- Every activated sub-index that matches a result writes its **Sub-result** under the same name in the corresponding **SearchResult**.
- An **Access handle** binds one **Sub-index name** to typed read/write helpers, hiding the `subQueries[name]` / `subResults[name]` indirection from user code.

## Example dialogue

> **Dev:** "I want to index documents with English summaries and French summaries. Two FTS sub-indexes?"
> **Maintainer:** "Yes — two sub-indexes both of modality type `"fulltext"`, with names you choose. Configure them at createIndex:
> ```ts
> setFullTextConfig(params, "q",    { language: "english" });
> setFullTextConfig(params, "q_fr", { language: "french" });
> ```
> Build one access handle per name: `const enFts = newFullTextAccess("q"); const frFts = newFullTextAccess("q_fr")`. The Index just stores two bindings; the FTS Provider builds both."
>
> **Dev:** "And if I switch embedding models later, do I have to re-index everything?"
> **Maintainer:** "Only the vector sub-index. Load the existing Index with `getIndex('docs', { subIndexes: { semantic: { type: 'vector', dimensionality: 384, model: 'newmodel' } } })`. The FTS sub-index adopts its saved state; the vector sub-index is reinit'd fresh with the new config. Re-ingest just the embeddings."

## Flagged ambiguities

- **"Adapter"** — `shared-adapters.newAdapter` carries parent-chain inheritance semantics intended for ambient context objects. The earlier draft of this contract used per-modality key-bound adapter pairs (`newSubIndex` / `newSubQuery` / `newSubResult`); that pattern was **retired** when the multi-instance model required runtime-named addressing. Sub-queries and sub-results are now read/written by **Sub-index name** through generic kernel helpers (`getSubQuery<Q>(request, name)`, `setSubResult<R>(result, name, hit)`) and per-modality **Access handles**.
- **"Hybrid"** — historically meant "FTS + vector blended". Fully retired from the contract. `Index.search` blends N sub-results with parameter-free RRF; there is no "hybrid" strategy noun or adjective in the API.
- **"IndexedBlock"** — legacy composite type carrying optional `content` + `embedding`. Removed: each sub-index owns its own block type; there is no composite ingestion shape, and no top-level `Index.addDocument`.
- **"Modality" vs "Modality type"** — "Modality" is the general concept (full-text, vector, graph). "**Modality type**" is the specific string identifier (`"fulltext"`, `"vector"`) used by providers and configs. A sub-index has *one* modality type; its sub-index name is independent.
- **"Self-serialising"** — applies to **Sub-indexes**, not to the composite **Index**. The Index orchestrates serialisation by iterating its sub-indexes and delegating; it carries no bytes itself.
