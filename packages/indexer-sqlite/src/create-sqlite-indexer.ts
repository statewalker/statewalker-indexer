import type { Db } from "@statewalker/db-api";
import type {
  AnySubIndexBinding,
  CreateIndexParams,
  GetIndexOptions,
  Index,
  Indexer,
  IndexInfo,
} from "@statewalker/indexer-api";
import { createCompositeIndex, createSerialiser, sanitizePrefix } from "@statewalker/indexer-core";
import { type BlockIds, openBlockIds } from "./block-ids.js";
import type { SqliteModalityContext, SqliteModalityProvider } from "./types.js";

export interface SqliteIndexerOptions {
  /** The database. The indexer never closes it. */
  db: Db;
  /** One provider per modality type, e.g. FTS5, vector, n-gram. */
  providers: SqliteModalityProvider[];
}

type SubSpec = { type: string } & Record<string, unknown>;
interface IndexManifest {
  subIndexes: Record<string, SubSpec>;
}

const MANIFEST_TABLE = "__indexer_manifest";

const indexPrefix = (name: string) => `idx_${sanitizePrefix(name)}__`;

/**
 * `Indexer` over one SQLite `Db`. Keeps a manifest row per Index, one shared
 * `{indexPrefix}blocks` id table per Index, and opens each sub-index through
 * its provider. Search fuses sub-indexes by RRF (`createCompositeIndex`).
 */
export async function createSqliteIndexer(options: SqliteIndexerOptions): Promise<Indexer> {
  const { db } = options;
  const providers = new Map(options.providers.map((p) => [p.type, p]));
  const indexes = new Map<string, Index>();
  const manifest = new Map<string, IndexManifest>();
  const runExclusive = createSerialiser();
  let closed = false;

  await db.exec(
    `CREATE TABLE IF NOT EXISTS ${MANIFEST_TABLE} (name TEXT PRIMARY KEY, config TEXT NOT NULL)`,
  );
  for (const row of await db.query<{ name: string; config: string }>(
    `SELECT name, config FROM ${MANIFEST_TABLE}`,
  )) {
    manifest.set(row.name, JSON.parse(row.config) as IndexManifest);
  }

  const ensureOpen = () => {
    if (closed) throw new Error("Indexer is closed");
  };

  const contextFor = (name: string, sub: string, blockIds: BlockIds): SqliteModalityContext => ({
    db,
    prefix: `${indexPrefix(name)}${sanitizePrefix(sub)}_`,
    blockIds,
  });

  async function writeManifest(name: string, entry: IndexManifest): Promise<void> {
    await db.query(
      `INSERT INTO ${MANIFEST_TABLE} (name, config) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET config = excluded.config`,
      [name, JSON.stringify(entry)],
    );
    manifest.set(name, entry);
  }

  async function dropIndexTables(name: string, subIndexes: Record<string, SubSpec>): Promise<void> {
    const blockIds = await openBlockIds(db, `${indexPrefix(name)}blocks`);
    for (const [sub, spec] of Object.entries(subIndexes)) {
      await providers.get(spec.type)?.drop(contextFor(name, sub, blockIds));
    }
    await db.exec(`DROP TABLE IF EXISTS ${blockIds.table}`);
    await db.query(`DELETE FROM ${MANIFEST_TABLE} WHERE name = ?`, [name]);
    manifest.delete(name);
  }

  async function openIndex(
    name: string,
    subIndexes: Record<string, SubSpec>,
    options?: GetIndexOptions,
  ): Promise<{ index: Index; effective: Record<string, SubSpec> }> {
    const onMissing = options?.onMissingProvider ?? "throw";
    const blockIds = await openBlockIds(db, `${indexPrefix(name)}blocks`);
    const bindings: AnySubIndexBinding[] = [];
    const effective: Record<string, SubSpec> = {};

    for (const [sub, saved] of Object.entries(subIndexes)) {
      const action = options?.subIndexes?.[sub];
      if (action && "skip" in action && action.skip === true) {
        effective[sub] = saved;
        continue;
      }
      const ctx = contextFor(name, sub, blockIds);
      const spec = action && !("skip" in action) ? (action as SubSpec) : saved;
      if (spec !== saved) await providers.get(saved.type)?.drop(ctx);

      const provider = providers.get(spec.type);
      if (!provider) {
        if (onMissing === "throw") {
          throw new Error(
            `Cannot load index: sub-index "${sub}" requires modality "${spec.type}" but only [${[
              ...providers.keys(),
            ]
              .map((t) => `"${t}"`)
              .join(", ")}] are registered.`,
          );
        }
        const g = globalThis as { console?: { warn(...args: unknown[]): void } };
        g.console?.warn(`Sub-index "${sub}" (type "${spec.type}") has no provider; skipping.`);
        effective[sub] = saved;
        continue;
      }
      const { type, ...config } = spec;
      bindings.push({ name: sub, type, config, index: await provider.open(ctx, config) });
      effective[sub] = spec;
    }

    const index = createCompositeIndex({
      name,
      bindings,
      onDeleteIndex: async () => {
        // Bound sub-indexes dropped themselves; skipped ones still own tables.
        for (const [sub, spec] of Object.entries(manifest.get(name)?.subIndexes ?? {})) {
          await providers.get(spec.type)?.drop(contextFor(name, sub, blockIds));
        }
        await db.exec(`DROP TABLE IF EXISTS ${blockIds.table}`);
        await db.query(`DELETE FROM ${MANIFEST_TABLE} WHERE name = ?`, [name]);
        manifest.delete(name);
        indexes.delete(name);
      },
    });
    return { index, effective };
  }

  return {
    async getIndexNames(): Promise<IndexInfo[]> {
      ensureOpen();
      return [...manifest.keys()].map((name) => ({ name }));
    },

    createIndex(params: CreateIndexParams): Promise<Index> {
      return runExclusive(async () => {
        ensureOpen();
        const { name, subIndexes, overwrite, metadata } = params;
        if (!subIndexes || Object.keys(subIndexes).length === 0) {
          throw new Error("Cannot create index without any subIndexes");
        }
        const existing = manifest.get(name);
        if (existing || indexes.has(name)) {
          if (!overwrite) throw new Error(`Index "${name}" already exists`);
          await indexes
            .get(name)
            ?.close()
            .catch(() => undefined);
          indexes.delete(name);
          await dropIndexTables(name, existing?.subIndexes ?? {});
        }
        const { index, effective } = await openIndex(name, subIndexes);
        await writeManifest(name, { subIndexes: effective });
        if (metadata !== undefined) (index as { metadata?: unknown }).metadata = metadata;
        indexes.set(name, index);
        return index;
      });
    },

    getIndex(name: string, options?: GetIndexOptions): Promise<Index | null> {
      // Serialised with createIndex so concurrent first opens open once
      // (a second reinit would otherwise drop tables the first just wrote).
      return runExclusive(async () => {
        ensureOpen();
        const cached = indexes.get(name);
        if (cached) return cached;
        const entry = manifest.get(name);
        if (!entry) return null;
        const { index, effective } = await openIndex(name, entry.subIndexes, options);
        if (JSON.stringify(effective) !== JSON.stringify(entry.subIndexes)) {
          await writeManifest(name, { subIndexes: effective });
        }
        indexes.set(name, index);
        return index;
      });
    },

    async hasIndex(name: string): Promise<boolean> {
      ensureOpen();
      return manifest.has(name);
    },

    async deleteIndex(name: string): Promise<void> {
      ensureOpen();
      const live = indexes.get(name);
      if (live) {
        await live.deleteIndex();
        return;
      }
      const entry = manifest.get(name);
      if (entry) await dropIndexTables(name, entry.subIndexes);
    },

    async flush(): Promise<void> {
      ensureOpen();
      for (const index of indexes.values()) await index.flush();
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const index of indexes.values()) await index.close().catch(() => undefined);
      indexes.clear();
    },
  } satisfies Indexer;
}
