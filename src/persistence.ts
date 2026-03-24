/** A named binary entry in a persistence stream */
export interface PersistenceEntry {
  name: string;
  content: AsyncIterable<Uint8Array>;
}

/** Storage backend for saving/loading indexer state */
export interface IndexerPersistence {
  /** Persist entries produced by the indexer */
  save(entries: AsyncIterable<PersistenceEntry>): Promise<void>;
  /** Load previously persisted entries */
  load(): AsyncIterable<PersistenceEntry>;
}
