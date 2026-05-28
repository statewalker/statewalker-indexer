// =============================================================================
// Indexer Contract — Operation Interfaces (kernel)
//
// The generic `SearchIndex` base (implemented by every sub-index), the
// `ModalityProvider` factory shape, the optional `PersistableSearchIndex`
// interface, the slim `SubIndexBinding` an `Index` stores per registered
// sub-index, and the composite `Index` itself (blending + lifecycle +
// registry only). Modality sub-index types live in the per-modality packages.
// Zero modality knowledge here.
// =============================================================================

import type { PersistenceEntry } from "../persistence.js";
import type {
  BlockReference,
  DocumentPath,
  Metadata,
  PathSelector,
  ScoredHit,
  SearchRequest,
  SearchResult,
} from "./types.js";

// =============================================================================
// 1. Generic search index base (implemented by every sub-index)
// =============================================================================

/**
 * Abstract base interface for all sub-indexes (FTS, embedding, future graph…).
 *
 * Owns ingestion, enumeration, search, and lifecycle for a single modality.
 *
 * @typeParam BlockType         The block shape accepted for ingestion.
 * @typeParam SearchParamsType  The (sub-)query type accepted by this index.
 * @typeParam SearchResultType  The hit shape produced; must extend {@link ScoredHit}.
 */
export interface SearchIndex<BlockType, SearchParamsType, SearchResultType extends ScoredHit> {
  // --- Search ----------------------------------------------------------------

  /** Execute a search and stream scored hits as an async generator. */
  search(params: SearchParamsType): AsyncGenerator<SearchResultType>;

  // --- Ingestion -------------------------------------------------------------

  /**
   * Add a single document's blocks to the index. All blocks **must** share the
   * same {@link DocumentPath}.
   */
  addDocument(blocks: BlockType[]): Promise<void>;

  /** Bulk-add documents from a (possibly async) iterable of block batches. */
  addDocuments(blocks: Iterable<BlockType[]> | AsyncIterable<BlockType[]>): Promise<void>;

  // --- Deletion --------------------------------------------------------------

  /** Delete blocks matching the given path selectors. */
  deleteDocuments(pathSelectors: PathSelector[] | AsyncIterable<PathSelector>): Promise<void>;

  // --- Enumeration -----------------------------------------------------------

  /** Count the number of blocks in the index (optionally under a prefix). */
  getSize(pathPrefix?: DocumentPath): Promise<number>;

  /** Stream all unique document paths in the index (optionally under a prefix). */
  getDocumentPaths(pathPrefix?: DocumentPath): AsyncGenerator<DocumentPath>;

  /** Stream all block references (path + blockId) in the index. */
  getDocumentBlocksRefs(pathPrefix?: DocumentPath): AsyncGenerator<BlockReference>;

  /** Stream all blocks (with full content / embedding data) in the index. */
  getDocumentsBlocks(pathPrefix?: DocumentPath): AsyncGenerator<BlockType>;

  // --- Lifecycle -------------------------------------------------------------

  /** Close the index and release associated resources. */
  close(options?: { force?: boolean }): Promise<void>;

  /** Flush pending writes so all previously added blocks become searchable. */
  flush(): Promise<void>;

  /** Permanently delete the entire index and all its contents. Irreversible. */
  deleteIndex(): Promise<void>;
}

// =============================================================================
// 2. Optional persistence opt-in
// =============================================================================

/**
 * Optional opt-in interface a {@link SearchIndex} implements when it knows how
 * to persist its own state. Non-persistable sub-indexes (e.g. live RPC-backed)
 * simply don't implement this — the composite save loop skips them.
 *
 * `serialise()` yields one or more named binary entries. `loadFrom()` restores
 * the sub-index from a previously-produced entry set. Entry names are local to
 * the sub-index — the composite namespaces them under `${indexName}/${name}/`
 * before they hit the persistence store.
 */
export interface PersistableSearchIndex<
  BlockType = unknown,
  SearchParamsType = unknown,
  SearchResultType extends ScoredHit = ScoredHit,
> extends SearchIndex<BlockType, SearchParamsType, SearchResultType> {
  /** Stream the sub-index's state as one or more named binary entries. */
  serialise(): AsyncIterable<PersistenceEntry>;
  /** Restore the sub-index's state from a previously-produced entry set. */
  loadFrom(entries: Iterable<PersistenceEntry>): Promise<void>;
}

/** Structural test: does this `SearchIndex` opt into persistence? */
export function isPersistable(
  index: SearchIndex<unknown, unknown, ScoredHit>,
): index is PersistableSearchIndex<unknown, unknown, ScoredHit> {
  const candidate = index as Partial<PersistableSearchIndex<unknown, unknown, ScoredHit>>;
  return typeof candidate.serialise === "function" && typeof candidate.loadFrom === "function";
}

// =============================================================================
// 3. Modality provider
// =============================================================================

/**
 * A typed factory bound to one **modality type**, owned by a backend. Knows how
 * to construct a sub-index instance from a typed config. Backends register one
 * Provider per modality type they support, at `Indexer` construction time.
 *
 * @typeParam C  The modality-specific config type (e.g. `FullTextConfig`).
 * @typeParam I  The sub-index type the Provider constructs (must implement
 *               `SearchIndex<…>`; may additionally implement
 *               `PersistableSearchIndex`).
 */
export interface ModalityProvider<
  C = unknown,
  I extends SearchIndex<unknown, unknown, ScoredHit> = SearchIndex<unknown, unknown, ScoredHit>,
> {
  /** The modality type this Provider serves, e.g. `"fulltext"` or `"vector"`. */
  readonly type: string;
  /** Construct a fresh sub-index instance from a typed config. */
  create(config: C): I;
}

// =============================================================================
// 4. Sub-index binding (data only — no closures)
// =============================================================================

/**
 * The unit an {@link Index} stores per registered sub-index. A 4-tuple of
 * stable data: the user-chosen name, the modality type, the typed config (kept
 * for manifest round-tripping on save), and the sub-index instance.
 *
 * The composite addresses sub-queries via `request.subQueries[binding.name]`
 * and sub-results via `result.subResults[binding.name]` directly — no closures
 * on the binding.
 *
 * `Q` and `R` parameters are nominal; the kernel stores `AnySubIndexBinding`
 * (the existential) because `R`'s invariance prevents safe upcasting.
 */
export interface SubIndexBinding<Q = unknown, R extends ScoredHit = ScoredHit> {
  /** Sub-index name (unique within its parent Index). */
  readonly name: string;
  /** Modality type identifier (e.g. `"fulltext"`, `"vector"`). */
  readonly type: string;
  /** Typed config stored for manifest round-tripping; opaque to the kernel. */
  readonly config: unknown;
  /** The sub-index instance — used for search dispatch and lifecycle fan-out. */
  readonly index: SearchIndex<unknown, Q, R>;
}

/**
 * Existential `SubIndexBinding` used by `Index` for storage and enumeration.
 *
 * `R` is invariant (it appears as both `index.search`'s yield type and the
 * input to whoever writes the sub-result back), so the kernel cannot safely
 * store a covariant supertype. Per-modality typed helpers (e.g. `FullTextAccess`)
 * narrow back to the concrete binding shape; the runtime invariant is that a
 * Provider constructs index + config + bound name together.
 */
// biome-ignore lint/suspicious/noExplicitAny: invariant `R` forces an existential at the kernel boundary; see above.
export type AnySubIndexBinding = SubIndexBinding<any, any>;

// =============================================================================
// 5. Composite index — open registry of sub-index bindings
// =============================================================================

/**
 * A named composite index: an open registry of named sub-index
 * {@link SubIndexBinding}s.
 *
 * Owns only **blending** ({@link Index.search} fuses active sub-indexes by RRF),
 * **lifecycle** fan-out, and the **registry** (`setBinding` / `getBinding` /
 * `getBindings`). Ingestion and enumeration are performed on the individual
 * sub-indexes (typically accessed via per-name Access handles like
 * `newFullTextAccess(name).get(index)`).
 */
export interface Index {
  /** Unique name of this index within the indexer. */
  readonly name: string;
  /** Optional index-level metadata. */
  readonly metadata?: Metadata;

  // --- Registry --------------------------------------------------------------

  /** Register (or replace) a sub-index binding under its name. */
  setBinding(binding: AnySubIndexBinding): void;
  /** Look up a binding by sub-index name, or `undefined` if not registered. */
  getBinding(name: string): AnySubIndexBinding | undefined;
  /** Enumerate all registered bindings, in registration order. */
  getBindings(): Iterable<AnySubIndexBinding>;

  // --- Blending --------------------------------------------------------------

  /**
   * Run every active sub-index (registered AND with a matching entry in
   * `request.subQueries`) and stream results fused by reciprocal-rank fusion.
   * The top-level `score` is always the RRF fusion score; native scores live
   * on each binding's sub-result attached under its name.
   */
  search(request: SearchRequest): AsyncGenerator<SearchResult>;

  // --- Lifecycle (fan-out to every binding) ----------------------------------

  /** Delete blocks matching the selectors across every sub-index. */
  deleteDocuments(pathSelectors: PathSelector[] | AsyncIterable<PathSelector>): Promise<void>;

  /** Flush pending writes across every sub-index. */
  flush(): Promise<void>;

  /** Close every sub-index and release resources. */
  close(options?: { force?: boolean }): Promise<void>;

  /** Permanently delete every sub-index. Irreversible. */
  deleteIndex(): Promise<void>;
}
