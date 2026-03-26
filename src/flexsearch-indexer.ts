import type {
  CreateIndexParams,
  Index,
  Indexer,
  IndexerPersistence,
  IndexInfo,
  PersistenceEntry,
} from "@repo/indexer-api";
import { MemIndex, MemVectorIndex } from "@repo/indexer-mem";
import { FlexSearchFullTextIndex } from "./flexsearch-full-text-index.js";

export interface FlexSearchIndexerOptions {
  persistence?: IndexerPersistence;
}

interface StoredIndexConfig {
  name: string;
  fulltext?: { language: string; metadata?: Record<string, unknown> };
  vector?: {
    dimensionality: number;
    model: string;
    metadata?: Record<string, unknown>;
  };
}

function toBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function singleChunk(data: Uint8Array): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      yield data;
    },
  };
}

async function readEntryBytes(entry: PersistenceEntry): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of entry.content) {
    chunks.push(chunk);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function createFlexSearchIndexer(
  options?: FlexSearchIndexerOptions,
): Indexer {
  const indexes = new Map<string, MemIndex>();
  const configs = new Map<string, StoredIndexConfig>();
  const manifest = new Map<string, IndexInfo>();
  let closed = false;
  let initialized = false;
  let initPromise: Promise<void> | null = null;

  const persistence = options?.persistence;

  function ensureOpen(): void {
    if (closed) {
      throw new Error("Indexer is closed");
    }
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

      let fts: FlexSearchFullTextIndex | null = null;
      let vec: MemVectorIndex | null = null;
      const restoredBlockIds = new Set<string>();

      if (config.fulltext) {
        const ftsJson = textEntries.get(`${name}/fts`);
        if (ftsJson) {
          fts = FlexSearchFullTextIndex.deserialize(config.fulltext, ftsJson);
          for (const id of fts.getAllBlockIds()) {
            restoredBlockIds.add(id);
          }
        } else {
          fts = new FlexSearchFullTextIndex(config.fulltext);
        }
      }

      if (config.vector) {
        const vecBytes = binaryEntries.get(`${name}/vec`);
        if (vecBytes) {
          vec = MemVectorIndex.deserializeFromArrow(config.vector, vecBytes);
          for (const id of vec.getBlockIds()) {
            restoredBlockIds.add(id);
          }
        } else {
          vec = new MemVectorIndex(config.vector);
        }
      }

      const index = new MemIndex(name, fts, vec);
      index.restoreTrackedBlockIds(restoredBlockIds);
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

        const index = indexes.get(indexName);
        if (!index) continue;

        const fts = index.getFullTextIndex();
        if (fts && fts instanceof FlexSearchFullTextIndex) {
          const data = await fts.serialize();
          yield {
            name: `${indexName}/fts`,
            content: singleChunk(toBytes(data)),
          };
        }

        const vec = index.getVectorIndex();
        if (vec && vec instanceof MemVectorIndex) {
          const arrowBytes = vec.serializeToArrow();
          yield {
            name: `${indexName}/vec`,
            content: singleChunk(arrowBytes),
          };
        }
      }
    }

    await persistence.save(generateEntries());
  }

  async function ensureInitialized(): Promise<void> {
    if (initialized) return;
    if (!initPromise) {
      initPromise = loadFromPersistence();
    }
    await initPromise;
  }

  const indexer: Indexer = {
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
          manifest.delete(name);
          configs.delete(name);
        } else {
          throw new Error(`Index "${name}" already exists`);
        }
      }

      const fts = fulltext
        ? new FlexSearchFullTextIndex({
            language: fulltext.language,
            metadata: fulltext.metadata,
          })
        : null;

      const vec = vector
        ? new MemVectorIndex({
            dimensionality: vector.dimensionality,
            model: vector.model,
            metadata: vector.metadata,
          })
        : null;

      const index = new MemIndex(name, fts, vec);
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
        manifest.delete(name);
        configs.delete(name);
      }
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
      manifest.clear();
      configs.clear();
    },
  };

  return indexer;
}
