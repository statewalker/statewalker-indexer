import type {
  AnySubIndexBinding,
  CreateIndexParams,
  IndexerPersistence,
  ModalityProvider,
  PersistableSearchIndex,
  PersistenceEntry,
  ScoredHit,
  SearchIndex,
} from "@statewalker/indexer-api";
import { describe, expect, it, vi } from "vitest";
import { createPersistenceBackedIndexer } from "../src/create-persistence-backed-indexer.js";

// --- Persistence backend (in-memory) --------------------------------------

function memPersistence(): IndexerPersistence & {
  readonly store: Map<string, Uint8Array>;
} {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    async save(entries: AsyncIterable<PersistenceEntry>) {
      store.clear();
      for await (const e of entries) {
        const chunks: Uint8Array[] = [];
        for await (const c of e.content) chunks.push(c);
        const total = chunks.reduce((n, c) => n + c.byteLength, 0);
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          merged.set(c, off);
          off += c.byteLength;
        }
        store.set(e.name, merged);
      }
    },
    async *load(): AsyncIterable<PersistenceEntry> {
      for (const [name, bytes] of store) {
        yield {
          name,
          content: (async function* () {
            yield bytes;
          })(),
        };
      }
    },
  };
}

// --- Test modality "alpha" ------------------------------------------------

interface AlphaConfig {
  flavour: string;
}
interface AlphaHit extends ScoredHit {
  payload?: string;
}

interface AlphaIndex extends SearchIndex<unknown, { q: string }, AlphaHit> {
  readonly config: AlphaConfig;
  state: string[];
}
interface AlphaPersistableIndex
  extends AlphaIndex,
    PersistableSearchIndex<unknown, { q: string }, AlphaHit> {}

function alphaProvider(opts?: {
  persistable?: boolean;
}): ModalityProvider<AlphaConfig, AlphaIndex> {
  return {
    type: "alpha",
    create(config: AlphaConfig): AlphaIndex {
      const state: string[] = [];
      const noop = (async () => undefined) as never;
      const base: AlphaIndex = {
        config,
        state,
        async *search() {},
        addDocument: noop,
        addDocuments: noop,
        deleteDocuments: noop,
        getSize: async () => 0,
        async *getDocumentPaths() {},
        async *getDocumentBlocksRefs() {},
        async *getDocumentsBlocks() {},
        close: noop,
        flush: noop,
        deleteIndex: noop,
      };
      if (!opts?.persistable) return base;
      const persistable: AlphaPersistableIndex = {
        ...base,
        async *serialise(): AsyncIterable<PersistenceEntry> {
          yield {
            name: "state",
            content: (async function* () {
              yield new TextEncoder().encode(JSON.stringify(state));
            })(),
          };
        },
        async loadFrom(entries: Iterable<PersistenceEntry>) {
          for (const e of entries) {
            const chunks: Uint8Array[] = [];
            for await (const c of e.content) chunks.push(c);
            const total = chunks.reduce((n, c) => n + c.byteLength, 0);
            const merged = new Uint8Array(total);
            let off = 0;
            for (const c of chunks) {
              merged.set(c, off);
              off += c.byteLength;
            }
            const decoded = new TextDecoder().decode(merged);
            const arr = JSON.parse(decoded) as string[];
            state.length = 0;
            for (const s of arr) state.push(s);
          }
        },
      };
      return persistable;
    },
  };
}

describe("createPersistenceBackedIndexer — Provider-driven", () => {
  it("createIndex routes by `type`, strips type from config, registers under user-chosen name", async () => {
    const provider = alphaProvider();
    const create = vi.spyOn(provider, "create");
    const indexer = createPersistenceBackedIndexer({ providers: [provider] });

    const params: CreateIndexParams = {
      name: "docs",
      subIndexes: { main: { type: "alpha", flavour: "chocolate" } },
    };
    const index = await indexer.createIndex(params);

    expect(create).toHaveBeenCalledWith({ flavour: "chocolate" });
    const binding = index.getBinding("main") as AnySubIndexBinding;
    expect(binding).toBeDefined();
    expect(binding.name).toBe("main");
    expect(binding.type).toBe("alpha");
  });

  it("createIndex throws when a type has no matching Provider", async () => {
    const indexer = createPersistenceBackedIndexer({ providers: [alphaProvider()] });
    await expect(
      indexer.createIndex({
        name: "docs",
        subIndexes: { x: { type: "missing-modality", foo: 1 } },
      }),
    ).rejects.toThrow(/missing-modality/);
  });

  it("save writes the per-Index manifest and (for persistable) the sub-index entries", async () => {
    const persistence = memPersistence();
    const indexer = createPersistenceBackedIndexer({
      providers: [alphaProvider({ persistable: true })],
      persistence,
    });
    const index = await indexer.createIndex({
      name: "docs",
      subIndexes: { main: { type: "alpha", flavour: "vanilla" } },
    });
    const binding = index.getBinding("main") as AnySubIndexBinding;
    const persistableIdx = binding.index as AlphaPersistableIndex;
    persistableIdx.state.push("a", "b");

    await indexer.flush();

    expect(persistence.store.has("__manifest__")).toBe(true);
    expect(persistence.store.has("docs/__manifest__")).toBe(true);
    expect(persistence.store.has("docs/main/state")).toBe(true);

    const manifest = JSON.parse(
      new TextDecoder().decode(persistence.store.get("docs/__manifest__") as Uint8Array),
    );
    expect(manifest).toEqual({
      name: "docs",
      subIndexes: { main: { type: "alpha", flavour: "vanilla" } },
    });

    const subState = JSON.parse(
      new TextDecoder().decode(persistence.store.get("docs/main/state") as Uint8Array),
    );
    expect(subState).toEqual(["a", "b"]);
  });

  it("non-persistable sub-index produces no per-name entries", async () => {
    const persistence = memPersistence();
    const indexer = createPersistenceBackedIndexer({
      providers: [alphaProvider()], // not persistable
      persistence,
    });
    await indexer.createIndex({
      name: "docs",
      subIndexes: { main: { type: "alpha", flavour: "x" } },
    });
    await indexer.flush();
    const subEntries = [...persistence.store.keys()].filter((k) => k.startsWith("docs/main/"));
    expect(subEntries).toEqual([]); // manifest only; no sub-index bytes
  });

  it("load with default (adopt) rebuilds Provider with saved config and calls loadFrom for persistable", async () => {
    const persistence = memPersistence();
    const writer = createPersistenceBackedIndexer({
      providers: [alphaProvider({ persistable: true })],
      persistence,
    });
    const idx = await writer.createIndex({
      name: "docs",
      subIndexes: { main: { type: "alpha", flavour: "vanilla" } },
    });
    (idx.getBinding("main") as AnySubIndexBinding).index;
    const bindWrite = idx.getBinding("main") as AnySubIndexBinding;
    (bindWrite.index as AlphaPersistableIndex).state.push("loaded");
    await writer.close();

    // New Indexer with same persistence + persistable Provider — adopt path.
    const reader = createPersistenceBackedIndexer({
      providers: [alphaProvider({ persistable: true })],
      persistence,
    });
    const reopened = await reader.getIndex("docs");
    expect(reopened).not.toBeNull();
    const b = reopened?.getBinding("main") as AnySubIndexBinding;
    expect(b).toBeDefined();
    expect((b.index as AlphaPersistableIndex).state).toEqual(["loaded"]);
  });

  it("load with reinit: ignores saved bytes, builds with new config", async () => {
    const persistence = memPersistence();
    const writer = createPersistenceBackedIndexer({
      providers: [alphaProvider({ persistable: true })],
      persistence,
    });
    const idx = await writer.createIndex({
      name: "docs",
      subIndexes: { main: { type: "alpha", flavour: "old" } },
    });
    (
      idx.getBinding("main") as AnySubIndexBinding & { index: AlphaPersistableIndex }
    ).index.state.push("ORIG");
    await writer.close();

    const reader = createPersistenceBackedIndexer({
      providers: [alphaProvider({ persistable: true })],
      persistence,
    });
    const reopened = await reader.getIndex("docs", {
      subIndexes: { main: { type: "alpha", flavour: "new" } },
    });
    expect(reopened).not.toBeNull();
    const b = reopened?.getBinding("main") as AnySubIndexBinding;
    expect((b.index as AlphaPersistableIndex).config.flavour).toBe("new");
    expect((b.index as AlphaPersistableIndex).state).toEqual([]); // not loaded
  });

  it("load with skip: that name is not registered on the loaded Index", async () => {
    const persistence = memPersistence();
    const writer = createPersistenceBackedIndexer({
      providers: [alphaProvider({ persistable: true })],
      persistence,
    });
    await writer.createIndex({
      name: "docs",
      subIndexes: {
        a: { type: "alpha", flavour: "x" },
        b: { type: "alpha", flavour: "y" },
      },
    });
    await writer.close();

    const reader = createPersistenceBackedIndexer({
      providers: [alphaProvider({ persistable: true })],
      persistence,
    });
    const reopened = await reader.getIndex("docs", {
      subIndexes: { b: { skip: true } },
    });
    expect(reopened?.getBinding("a")).toBeDefined();
    expect(reopened?.getBinding("b")).toBeUndefined();
  });

  it("onMissingProvider=throw (default) refuses to load when a saved type has no Provider", async () => {
    const persistence = memPersistence();
    const writer = createPersistenceBackedIndexer({
      providers: [alphaProvider({ persistable: true })],
      persistence,
    });
    await writer.createIndex({
      name: "docs",
      subIndexes: { main: { type: "alpha", flavour: "x" } },
    });
    await writer.close();

    const reader = createPersistenceBackedIndexer({
      providers: [], // no provider for "alpha"
      persistence,
    });
    await expect(reader.getIndex("docs")).rejects.toThrow(/alpha/);
  });

  it("onMissingProvider=warn skips the offending name without throwing", async () => {
    const persistence = memPersistence();
    const writer = createPersistenceBackedIndexer({
      providers: [alphaProvider({ persistable: true })],
      persistence,
    });
    await writer.createIndex({
      name: "docs",
      subIndexes: { main: { type: "alpha", flavour: "x" } },
    });
    await writer.close();

    const reader = createPersistenceBackedIndexer({
      providers: [],
      persistence,
    });
    const reopened = await reader.getIndex("docs", { onMissingProvider: "warn" });
    expect(reopened).not.toBeNull();
    expect(reopened?.getBinding("main")).toBeUndefined();
  });

  it("concurrent overwrite-createIndex calls serialise via the mutex", async () => {
    const indexer = createPersistenceBackedIndexer({ providers: [alphaProvider()] });
    await indexer.createIndex({
      name: "race",
      subIndexes: { x: { type: "alpha", flavour: "a" } },
    });
    await Promise.all([
      indexer.createIndex({
        name: "race",
        overwrite: true,
        subIndexes: { x: { type: "alpha", flavour: "b" } },
      }),
      indexer.createIndex({
        name: "race",
        overwrite: true,
        subIndexes: { x: { type: "alpha", flavour: "c" } },
      }),
    ]);
    expect(await indexer.hasIndex("race")).toBe(true);
    const live = await indexer.getIndex("race");
    expect(live).not.toBeNull();
  });
});
