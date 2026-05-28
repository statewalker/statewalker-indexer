import type {
  AnySubIndexBinding,
  CreateIndexParams,
  GetIndexOptions,
  Index,
  Indexer,
  IndexerPersistence,
  IndexInfo,
  ModalityProvider,
  PersistenceEntry,
  ScoredHit,
  SearchIndex,
} from "@statewalker/indexer-api";
import { isPersistable } from "@statewalker/indexer-api";
import { createCompositeIndex } from "./create-composite-index.js";
import { readEntryBytes, singleChunk, toBytes } from "./persistence-bytes.js";
import { createSerialiser } from "./run-exclusive.js";

/**
 * Options for {@link createPersistenceBackedIndexer}.
 *
 * `providers` declares the modalities this Indexer can construct; the factory
 * looks each one up at `createIndex` / `getIndex` time by the `type`
 * discriminator in `params.subIndexes` or the saved manifest.
 *
 * `persistence` is the optional storage port. When absent, the Indexer runs in
 * pure in-memory mode.
 */
export interface PersistenceBackedIndexerOptions {
  providers: ModalityProvider<unknown, SearchIndex<unknown, unknown, ScoredHit>>[];
  persistence?: IndexerPersistence;
}

/** Saved per-Index manifest payload. */
interface IndexManifest {
  name: string;
  subIndexes: Record<string, { type: string } & Record<string, unknown>>;
}

const TOP_MANIFEST = "__manifest__";

/**
 * Generic persistence-backed `Indexer` factory. Modality-agnostic: takes a list
 * of `ModalityProvider`s and routes by the `type` discriminator. Sub-index
 * serialisation flows through each sub-index's own `PersistableSearchIndex`
 * implementation; non-persistable modalities are simply skipped at save.
 *
 * Wire format under one `IndexerPersistence` store:
 * - `__manifest__` — JSON array of all known index names
 * - `${indexName}/__manifest__` — JSON `IndexManifest` (mirrors `CreateIndexParams.subIndexes`)
 * - `${indexName}/${subIndexName}/<entry>` — each persistable sub-index's `serialise()` output,
 *   prefixed to keep entries namespaced across sub-indexes and Indexes
 */
export function createPersistenceBackedIndexer(opts: PersistenceBackedIndexerOptions): Indexer {
  const providersByType = new Map<
    string,
    ModalityProvider<unknown, SearchIndex<unknown, unknown, ScoredHit>>
  >();
  for (const p of opts.providers) providersByType.set(p.type, p);

  const persistence = opts.persistence;
  const runExclusive = createSerialiser();

  // In-memory caches.
  const liveIndexes = new Map<string, Index>(); // currently-open indexes
  const knownNames = new Set<string>(); // names from manifest (live or not)
  // Pre-loaded entries grouped per Index, parsed on construction or save.
  // Map<indexName, Map<subIndexName, Map<entrySuffix, Uint8Array>>>
  // Manifest lives separately to keep lookup straightforward.
  const savedManifests = new Map<string, IndexManifest>();
  // Sub-index entry pools cached as raw bytes so the same entry can be replayed
  // across multiple saves: Map<indexName, Map<subIndexName, Map<suffix, bytes>>>
  const savedSubEntries = new Map<string, Map<string, Map<string, Uint8Array>>>();
  // Sub-index names skipped at load via `{skip: true}`. Per D9, their saved
  // manifest entries + bytes must survive the next save unchanged.
  const skippedSubsPerIndex = new Map<string, Set<string>>();

  let initialized = false;
  let initPromise: Promise<void> | null = null;
  let closed = false;

  function ensureOpen(): void {
    if (closed) throw new Error("Indexer is closed");
  }

  function findProvider(
    type: string,
  ): ModalityProvider<unknown, SearchIndex<unknown, unknown, ScoredHit>> | undefined {
    return providersByType.get(type);
  }

  function listProviderTypes(): string[] {
    return [...providersByType.keys()];
  }

  async function loadFromPersistence(): Promise<void> {
    if (!persistence || initialized) return;
    const textEntries = new Map<string, string>();
    const subEntryBytes = new Map<string, Uint8Array>();

    for await (const entry of persistence.load()) {
      const bytes = await readEntryBytes(entry);
      // Heuristic: text manifests are JSON-decodable; per-sub entries are kept as bytes.
      if (entry.name === TOP_MANIFEST || entry.name.endsWith("/__manifest__")) {
        textEntries.set(entry.name, new TextDecoder().decode(bytes));
      } else {
        subEntryBytes.set(entry.name, bytes);
      }
    }

    const topJson = textEntries.get(TOP_MANIFEST);
    if (topJson) {
      const names = JSON.parse(topJson) as string[];
      for (const name of names) knownNames.add(name);
    }

    for (const name of knownNames) {
      const manifestJson = textEntries.get(`${name}/__manifest__`);
      if (manifestJson) {
        savedManifests.set(name, JSON.parse(manifestJson) as IndexManifest);
      }
    }

    // Group sub-index entries by (indexName, subIndexName).
    for (const [entryName, bytes] of subEntryBytes) {
      // entryName = "<indexName>/<subIndexName>/<suffix>" — at least 2 slashes.
      const firstSlash = entryName.indexOf("/");
      if (firstSlash < 0) continue;
      const secondSlash = entryName.indexOf("/", firstSlash + 1);
      if (secondSlash < 0) continue;
      const indexName = entryName.slice(0, firstSlash);
      const subName = entryName.slice(firstSlash + 1, secondSlash);
      const suffix = entryName.slice(secondSlash + 1);
      let perIndex = savedSubEntries.get(indexName);
      if (!perIndex) {
        perIndex = new Map();
        savedSubEntries.set(indexName, perIndex);
      }
      let perSub = perIndex.get(subName);
      if (!perSub) {
        perSub = new Map();
        perIndex.set(subName, perSub);
      }
      perSub.set(suffix, bytes);
    }

    initialized = true;
  }

  async function ensureInitialized(): Promise<void> {
    if (initialized) return;
    if (!initPromise) {
      initPromise = loadFromPersistence().catch((err) => {
        initPromise = null;
        throw err;
      });
    }
    await initPromise;
  }

  function emitEntry(entryName: string, bytes: Uint8Array): PersistenceEntry {
    return { name: entryName, content: singleChunk(bytes) };
  }

  async function saveToPersistence(): Promise<void> {
    if (!persistence) return;
    const self = {
      async *generate(): AsyncIterable<PersistenceEntry> {
        const allNames = new Set<string>([...knownNames]);
        for (const n of liveIndexes.keys()) allNames.add(n);
        yield emitEntry(TOP_MANIFEST, toBytes(JSON.stringify([...allNames])));

        for (const indexName of allNames) {
          const live = liveIndexes.get(indexName);
          if (live) {
            // Skipped sub-indexes (per D9): their saved manifest + entries are
            // preserved verbatim through the next save.
            const skipped = skippedSubsPerIndex.get(indexName);
            const savedM = savedManifests.get(indexName);
            const savedSubs = savedSubEntries.get(indexName);

            // Compose manifest from live bindings + preserved skipped configs.
            const manifest: IndexManifest = { name: indexName, subIndexes: {} };
            for (const b of live.getBindings()) {
              manifest.subIndexes[b.name] = {
                type: b.type,
                ...(b.config as Record<string, unknown>),
              };
            }
            if (skipped && savedM) {
              for (const subName of skipped) {
                const spec = savedM.subIndexes[subName];
                if (spec) manifest.subIndexes[subName] = spec;
              }
            }
            yield emitEntry(`${indexName}/__manifest__`, toBytes(JSON.stringify(manifest)));

            // Persistable bindings stream their entries under `${indexName}/${b.name}/<suffix>`.
            for (const b of live.getBindings()) {
              if (!isPersistable(b.index)) continue;
              for await (const sub of b.index.serialise()) {
                const bytes = await readEntryBytes(sub);
                yield emitEntry(`${indexName}/${b.name}/${sub.name}`, bytes);
              }
            }

            // Re-emit saved entries for skipped sub-indexes verbatim.
            if (skipped && savedSubs) {
              for (const subName of skipped) {
                const entries = savedSubs.get(subName);
                if (!entries) continue;
                for (const [suffix, bytes] of entries) {
                  yield emitEntry(`${indexName}/${subName}/${suffix}`, bytes);
                }
              }
            }
          } else {
            // Index not open in this session — preserve saved bytes.
            const savedM = savedManifests.get(indexName);
            if (savedM)
              yield emitEntry(`${indexName}/__manifest__`, toBytes(JSON.stringify(savedM)));
            const perIndex = savedSubEntries.get(indexName);
            if (perIndex) {
              for (const [subName, entries] of perIndex) {
                for (const [suffix, bytes] of entries) {
                  yield emitEntry(`${indexName}/${subName}/${suffix}`, bytes);
                }
              }
            }
          }
        }
      },
    };

    await persistence.save(self.generate());
  }

  async function buildIndex(name: string, options?: GetIndexOptions): Promise<Index> {
    const manifest = savedManifests.get(name);
    if (!manifest) {
      // No saved manifest — Index isn't yet persisted; nothing to load from.
      return createCompositeIndex({ name });
    }

    const onMissing: "throw" | "warn" = options?.onMissingProvider ?? "throw";
    const optSubIndexes = options?.subIndexes;

    const bindings: AnySubIndexBinding[] = [];
    const skipped = new Set<string>();
    const perIndex = savedSubEntries.get(name);
    for (const [subName, savedSpec] of Object.entries(manifest.subIndexes)) {
      const action = optSubIndexes?.[subName];
      if (action && "skip" in action && action.skip === true) {
        skipped.add(subName); // preserve saved bytes through next save (D9)
        continue;
      }

      // Determine effective type + config + whether to call loadFrom.
      let effType: string;
      let effConfig: Record<string, unknown>;
      let useLoadFrom: boolean;
      if (action && !("skip" in action)) {
        const { type: actType, ...rest } = action;
        effType = actType;
        effConfig = rest;
        useLoadFrom = false; // reinit
      } else {
        const { type: savedType, ...rest } = savedSpec;
        effType = savedType;
        effConfig = rest;
        useLoadFrom = true; // adopt
      }

      const provider = findProvider(effType);
      if (!provider) {
        if (onMissing === "throw") {
          throw new Error(
            `Cannot load index "${name}": sub-index "${subName}" requires a provider of type "${effType}" but only [${listProviderTypes()
              .map((t) => `"${t}"`)
              .join(", ")}] are registered.`,
          );
        }
        // warn → skip silently apart from the console warning
        const g = globalThis as { console?: { warn(...args: unknown[]): void } };
        g.console?.warn(
          `Sub-index "${subName}" (type "${effType}") on index "${name}" has no matching Provider; skipping.`,
        );
        continue;
      }

      const subIndex = provider.create(effConfig);
      if (useLoadFrom && isPersistable(subIndex)) {
        const bytesBySuffix = perIndex?.get(subName);
        if (bytesBySuffix && bytesBySuffix.size > 0) {
          const entries: PersistenceEntry[] = [];
          for (const [suffix, bytes] of bytesBySuffix) {
            entries.push({ name: suffix, content: singleChunk(bytes) });
          }
          await subIndex.loadFrom(entries);
        }
      }
      bindings.push({ name: subName, type: effType, config: effConfig, index: subIndex });
    }

    if (skipped.size > 0) skippedSubsPerIndex.set(name, skipped);
    return createCompositeIndex({ name, bindings });
  }

  return {
    async getIndexNames(): Promise<IndexInfo[]> {
      ensureOpen();
      await ensureInitialized();
      return [...knownNames].map((name) => ({ name }));
    },

    createIndex(params: CreateIndexParams): Promise<Index> {
      return runExclusive(async () => {
        ensureOpen();
        await ensureInitialized();
        const { name, subIndexes, overwrite, metadata } = params;

        if (knownNames.has(name) || liveIndexes.has(name)) {
          if (!overwrite) throw new Error(`Index "${name}" already exists`);
          const live = liveIndexes.get(name);
          if (live) await live.close();
          liveIndexes.delete(name);
          savedManifests.delete(name);
          savedSubEntries.delete(name);
          knownNames.delete(name);
        }

        const bindings: AnySubIndexBinding[] = [];
        for (const [subName, spec] of Object.entries(subIndexes ?? {})) {
          const { type, ...config } = spec;
          const provider = findProvider(type);
          if (!provider) {
            throw new Error(
              `Cannot create index "${name}": sub-index "${subName}" requires a provider of type "${type}" but only [${listProviderTypes()
                .map((t) => `"${t}"`)
                .join(", ")}] are registered.`,
            );
          }
          const subIndex = provider.create(config);
          bindings.push({ name: subName, type, config, index: subIndex });
        }

        const index = createCompositeIndex({ name, metadata, bindings });
        liveIndexes.set(name, index);
        knownNames.add(name);
        return index;
      });
    },

    async getIndex(name: string, options?: GetIndexOptions): Promise<Index | null> {
      ensureOpen();
      await ensureInitialized();
      if (!knownNames.has(name) && !liveIndexes.has(name)) return null;
      const live = liveIndexes.get(name);
      if (live) return live;
      const built = await buildIndex(name, options);
      liveIndexes.set(name, built);
      return built;
    },

    async hasIndex(name: string): Promise<boolean> {
      ensureOpen();
      await ensureInitialized();
      return knownNames.has(name) || liveIndexes.has(name);
    },

    async deleteIndex(name: string): Promise<void> {
      ensureOpen();
      await ensureInitialized();
      const live = liveIndexes.get(name);
      if (live) {
        await live.close();
        liveIndexes.delete(name);
      }
      savedManifests.delete(name);
      savedSubEntries.delete(name);
      knownNames.delete(name);
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
      for (const index of liveIndexes.values()) await index.close();
      liveIndexes.clear();
    },
  };
}
