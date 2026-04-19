import type { Index, Metadata } from "./indexer-index.js";

/**
 * Parameters for creating a new hybrid search index.
 *
 * At least one of `fulltext` or `vector` must be provided — an index with
 * neither sub-index has no search capability.
 */
export interface CreateIndexParams {
  /** Unique name identifying the index within the {@link Indexer}. */
  name: string;
  /**
   * Configuration for the full-text search sub-index.
   * When omitted, the index will not support FTS queries.
   */
  fulltext?: { language: string; metadata?: Metadata };
  /**
   * Configuration for the vector / embedding sub-index.
   * When omitted, the index will not support vector similarity search.
   */
  vector?: { dimensionality: number; model: string; metadata?: Metadata };
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
 * Top-level entry point for managing hybrid search indexes.
 *
 * An {@link Indexer} acts as a registry / factory: it creates, opens, lists,
 * and deletes named {@link Index} instances that may combine full-text and
 * vector sub-indexes.
 */
export interface Indexer {
  /**
   * List all indexes known to this indexer.
   *
   * @returns Summary information for every registered index.
   */
  getIndexNames(): Promise<IndexInfo[]>;

  /**
   * Create a new index with the given configuration.
   *
   * @param params  Index name, sub-index configs, and overwrite flag.
   * @returns The newly created {@link Index}.
   * @throws If an index with the same name already exists and `overwrite` is `false`.
   */
  createIndex(params: CreateIndexParams): Promise<Index>;

  /**
   * Open an existing index by name.
   *
   * @returns The {@link Index} if it exists, or `null` otherwise.
   */
  getIndex(name: string): Promise<Index | null>;

  /**
   * Check whether an index with the given name exists.
   */
  hasIndex(name: string): Promise<boolean>;

  /**
   * Permanently delete an index and all its contents.
   *
   * @throws If the index does not exist (implementations may also silently ignore).
   */
  deleteIndex(name: string): Promise<void>;

  /**
   * Persist any pending state to storage without closing the indexer.
   *
   * Implementations backed by in-memory buffers or write-ahead logs should
   * ensure all data is durable after this call returns.
   */
  flush(): Promise<void>;

  /**
   * Close the indexer and release all associated resources.
   *
   * All open indexes are closed. After this call the indexer instance
   * should be considered unusable.
   */
  close(): Promise<void>;
}
