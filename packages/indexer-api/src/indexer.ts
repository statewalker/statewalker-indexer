import type { Index } from "./contract/index.js";
import type { Metadata } from "./contract/types.js";

/**
 * Parameters for creating a new composite index.
 *
 * `subIndexes` is a `Record` keyed by user-chosen **sub-index name**. Each
 * value is an arbitrary record carrying the modality `type` discriminator
 * (used by the Indexer to find the matching `ModalityProvider`) plus the
 * modality's typed config fields. Use a modality package's typed
 * `set{Modality}Config(params, name, config)` helper rather than writing
 * this map directly.
 */
export interface CreateIndexParams {
  /** Unique name identifying the index within the {@link Indexer}. */
  name: string;
  /** Optional index-level metadata. */
  metadata?: Metadata;
  /**
   * Per-sub-index creation config, keyed by user-chosen **sub-index name**.
   * Each value carries a `type` discriminator plus modality-specific fields.
   */
  subIndexes?: Record<string, { type: string } & Record<string, unknown>>;
  /**
   * When `true`, an existing index with the same name is deleted and
   * recreated. When `false` (default), creating a duplicate name throws.
   */
  overwrite?: boolean;
}

/**
 * Summary information about an existing index.
 */
export interface IndexInfo {
  /** The unique name of the index. */
  name: string;
  /** Optional index-level metadata. */
  metadata?: Metadata;
}

/**
 * Per-sub-index load action passed to {@link Indexer.getIndex}.
 *
 * - `{ skip: true }` — do not register a binding for this name on the loaded
 *   Index. Saved bytes remain on disk and are preserved until the next save
 *   rewrites the manifest without this name.
 * - `{ type, ...config }` — reinit: the Provider for `type` is called with this
 *   config; `loadFrom` is NOT invoked. The supplied config replaces the saved
 *   config in the next manifest write.
 *
 * Absence of an entry for a given name means "adopt": the Provider rebuilds
 * the sub-index from the saved config and (if persistable) loads saved bytes.
 */
export type LoadAction = { skip: true } | ({ type: string } & Record<string, unknown>);

/** Options passed to {@link Indexer.getIndex}. */
export interface GetIndexOptions {
  /** Per-name load actions. Names omitted default to "adopt saved state". */
  subIndexes?: Record<string, LoadAction>;
  /**
   * Policy for names in the saved manifest whose modality `type` has no
   * matching runtime Provider. Default is `"throw"`; `"warn"` logs and treats
   * the name as skipped.
   */
  onMissingProvider?: "throw" | "warn";
}

/**
 * Top-level entry point for managing composite indexes.
 *
 * An {@link Indexer} acts as a registry / factory: it creates, opens, lists,
 * and deletes named {@link Index} instances, each an open registry of named
 * sub-indexes.
 */
export interface Indexer {
  /** List all indexes known to this indexer. */
  getIndexNames(): Promise<IndexInfo[]>;

  /**
   * Create a new index with the given configuration.
   *
   * @throws If an index with the same name already exists and `overwrite` is `false`.
   * @throws If any entry in `params.subIndexes` carries a `type` with no
   *         registered Provider.
   */
  createIndex(params: CreateIndexParams): Promise<Index>;

  /**
   * Open an existing index by name. Applies per-sub-index load actions.
   *
   * @returns The opened Index, or `null` if no Index with `name` exists.
   * @throws Under `onMissingProvider: "throw"` (default), throws when any
   *         saved sub-index `type` has no matching runtime Provider.
   */
  getIndex(name: string, options?: GetIndexOptions): Promise<Index | null>;

  /** Check whether an index with the given name exists. */
  hasIndex(name: string): Promise<boolean>;

  /** Permanently delete an index and all its contents. */
  deleteIndex(name: string): Promise<void>;

  /** Persist any pending state to storage without closing the indexer. */
  flush(): Promise<void>;

  /** Close the indexer and release all associated resources. */
  close(): Promise<void>;
}
