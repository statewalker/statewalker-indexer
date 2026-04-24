import type {
  CreateIndexParams,
  EmbeddingIndex,
  EmbeddingIndexInfo,
  FullTextIndex,
  FullTextIndexInfo,
  Index,
  Indexer,
  IndexerPersistence,
  IndexInfo,
  PersistenceEntry,
} from "@statewalker/indexer-api";
import { createCompositeIndex } from "./create-composite-index.js";
import { readEntryBytes, singleChunk, toBytes } from "./persistence-bytes.js";

/** Stored per-index config for the persistence-backed wire format. */
interface StoredIndexConfig {
  name: string;
  fulltext?: FullTextIndexInfo;
  vector?: EmbeddingIndexInfo;
}

export interface PersistenceBackedIndexerOptions<
  F extends FullTextIndex,
  V extends EmbeddingIndex,
> {
  /** Build a fresh FTS sub-index from its info. */
  createFts(info: FullTextIndexInfo): F;
  /** Serialize an FTS sub-index to a JSON/text payload. Sync or async. */
  serializeFts(fts: F): string | Promise<string>;
  /** Build an FTS sub-index from a serialized payload + its info. */
  deserializeFts(info: FullTextIndexInfo, data: string): F;

  /** Build a fresh vector sub-index from its info. */
  createVec(info: EmbeddingIndexInfo): V;
  /** Serialize a vector sub-index to a binary payload. Sync or async. */
  serializeVec(vec: V): Uint8Array | Promise<Uint8Array>;
  /** Build a vector sub-index from a serialized binary payload + its info. */
  deserializeVec(info: EmbeddingIndexInfo, data: Uint8Array): V;

  /** Optional persistence port. When absent, the indexer runs in pure in-memory mode. */
  persistence?: IndexerPersistence;
}

/**
 * Generic persistence-backed `Indexer` factory for in-memory backends.
 *
 * Wire format (preserved byte-for-byte from the pre-refactor flexsearch/minisearch factories):
 *   - `__manifest__` : JSON array of index names
 *   - `${name}/__config__` : JSON of StoredIndexConfig for each index
 *   - `${name}/fts` : UTF-8 bytes of serialized FTS (text payload)
 *   - `${name}/vec` : binary bytes of serialized vector sub-index
 *
 * Replaces the ~287-LOC `createFlexSearchIndexer` / `createMiniSearchIndexer` factories.
 */
export function createPersistenceBackedIndexer<F extends FullTextIndex, V extends EmbeddingIndex>(
  opts: PersistenceBackedIndexerOptions<F, V>,
): Indexer {
  const indexes = new Map<string, Index>();
  const ftsInstances = new Map<string, F>();
  const vecInstances = new Map<string, V>();
  const configs = new Map<string, StoredIndexConfig>();
  const manifest = new Map<string, IndexInfo>();
  let closed = false;
  let initialized = false;
  let initPromise: Promise<void> | null = null;

  const persistence = opts.persistence;

  function ensureOpen(): void {
    if (closed) throw new Error("Indexer is closed");
  }

  async function loadFromPersistence(): Promise<void> {
    if (!persistence || initialized) return;
    initialized = true;

    const textEntries = new Map<string, string>();
    const binaryEntries = new Map<string, Uint8Array>();
    for await (const entry of persistence.load()) {
      const bytes = await readEntryBytes(entry);
      binaryEntries.set(entry.name, bytes);
      textEntries.set(entry.name, new TextDecoder().decode(bytes));
    }

    const manifestJson = textEntries.get("__manifest__");
    if (!manifestJson) return;

    const indexNames = JSON.parse(manifestJson) as string[];

    for (const name of indexNames) {
      const configJson = textEntries.get(`${name}/__config__`);
      if (!configJson) continue;

      const config = JSON.parse(configJson) as StoredIndexConfig;
      configs.set(name, config);

      let fts: F | null = null;
      let vec: V | null = null;

      if (config.fulltext) {
        const ftsJson = textEntries.get(`${name}/fts`);
        fts = ftsJson
          ? opts.deserializeFts(config.fulltext, ftsJson)
          : opts.createFts(config.fulltext);
        ftsInstances.set(name, fts);
      }

      if (config.vector) {
        const vecBytes = binaryEntries.get(`${name}/vec`);
        vec = vecBytes
          ? opts.deserializeVec(config.vector, vecBytes)
          : opts.createVec(config.vector);
        vecInstances.set(name, vec);
      }

      const index = createCompositeIndex({ name, fts, vec });
      indexes.set(name, index);
      manifest.set(name, { name });
    }
  }

  async function saveToPersistence(): Promise<void> {
    if (!persistence) return;

    async function* generateEntries(): AsyncIterable<PersistenceEntry> {
      const names = [...indexes.keys()];
      yield {
        name: "__manifest__",
        content: singleChunk(toBytes(JSON.stringify(names))),
      };

      for (const indexName of names) {
        const config = configs.get(indexName);
        if (config) {
          yield {
            name: `${indexName}/__config__`,
            content: singleChunk(toBytes(JSON.stringify(config))),
          };
        }

        const fts = ftsInstances.get(indexName);
        if (fts) {
          const data = await opts.serializeFts(fts);
          yield {
            name: `${indexName}/fts`,
            content: singleChunk(toBytes(data)),
          };
        }

        const vec = vecInstances.get(indexName);
        if (vec) {
          const bytes = await opts.serializeVec(vec);
          yield {
            name: `${indexName}/vec`,
            content: singleChunk(bytes),
          };
        }
      }
    }

    await persistence.save(generateEntries());
  }

  async function ensureInitialized(): Promise<void> {
    if (initialized) return;
    if (!initPromise) initPromise = loadFromPersistence();
    await initPromise;
  }

  return {
    async getIndexNames(): Promise<IndexInfo[]> {
      ensureOpen();
      await ensureInitialized();
      return [...manifest.values()];
    },

    async createIndex(params: CreateIndexParams): Promise<Index> {
      ensureOpen();
      await ensureInitialized();
      const { name, fulltext, vector, overwrite } = params;

      if (!fulltext && !vector) {
        throw new Error("At least one of fulltext or vector must be provided");
      }

      if (indexes.has(name)) {
        if (overwrite) {
          const old = indexes.get(name);
          await old?.close();
          indexes.delete(name);
          ftsInstances.delete(name);
          vecInstances.delete(name);
          manifest.delete(name);
          configs.delete(name);
        } else {
          throw new Error(`Index "${name}" already exists`);
        }
      }

      const fts = fulltext ? opts.createFts(fulltext) : null;
      if (fts) ftsInstances.set(name, fts);

      const vec = vector ? opts.createVec(vector) : null;
      if (vec) vecInstances.set(name, vec);

      const index = createCompositeIndex({ name, fts, vec });
      indexes.set(name, index);
      manifest.set(name, { name });
      configs.set(name, { name, fulltext, vector });

      return index;
    },

    async getIndex(name: string): Promise<Index | null> {
      ensureOpen();
      await ensureInitialized();
      return indexes.get(name) ?? null;
    },

    async hasIndex(name: string): Promise<boolean> {
      ensureOpen();
      await ensureInitialized();
      return indexes.has(name);
    },

    async deleteIndex(name: string): Promise<void> {
      ensureOpen();
      await ensureInitialized();
      const index = indexes.get(name);
      if (index) {
        await index.close();
        indexes.delete(name);
        ftsInstances.delete(name);
        vecInstances.delete(name);
        manifest.delete(name);
        configs.delete(name);
      }
    },

    async flush(): Promise<void> {
      ensureOpen();
      await ensureInitialized();
      await saveToPersistence();
    },

    async close(): Promise<void> {
      if (closed) return;
      await ensureInitialized();
      await saveToPersistence();
      closed = true;
      for (const index of indexes.values()) {
        await index.close();
      }
      indexes.clear();
      ftsInstances.clear();
      vecInstances.clear();
      manifest.clear();
      configs.clear();
    },
  };
}
