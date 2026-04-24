import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import type { CreateIndexParams, Index, Indexer, IndexInfo } from "@statewalker/indexer-api";
import { sanitizePrefix } from "@statewalker/indexer-core";
import { PGLiteFullTextIndex } from "./pglite-full-text-index.js";
import { PGLiteIndex } from "./pglite-index.js";
import { PGLiteVectorIndex } from "./pglite-vector-index.js";

export interface PGLiteIndexerOptions {
  db?: PGlite;
}

export async function createPGLiteIndexer(options?: PGLiteIndexerOptions): Promise<Indexer> {
  const ownsDb = !options?.db;
  const db = options?.db ?? (await PGlite.create({ extensions: { vector } }));
  const indexes = new Map<string, Index>();
  const manifest = new Map<string, IndexInfo>();
  let closed = false;

  await db.exec("CREATE EXTENSION IF NOT EXISTS vector");

  await db.exec(
    "CREATE TABLE IF NOT EXISTS __indexer_manifest (name TEXT PRIMARY KEY, config TEXT NOT NULL)",
  );

  const existingEntries = await db.query<{ name: string; config: string }>(
    "SELECT name, config FROM __indexer_manifest",
  );
  for (const entry of existingEntries.rows) {
    manifest.set(entry.name, { name: entry.name });
  }

  function ensureOpen(): void {
    if (closed) {
      throw new Error("Indexer is closed");
    }
  }

  async function createDocsTable(prefix: string): Promise<string> {
    const docsTable = `idx_${prefix}_docs`;
    await db.exec(
      `CREATE TABLE IF NOT EXISTS ${docsTable} (doc_id SERIAL PRIMARY KEY, path TEXT NOT NULL UNIQUE)`,
    );
    return docsTable;
  }

  const indexer: Indexer = {
    async getIndexNames(): Promise<IndexInfo[]> {
      ensureOpen();
      return [...manifest.values()];
    },

    async createIndex(params: CreateIndexParams): Promise<Index> {
      ensureOpen();
      const { name, fulltext, vector, overwrite } = params;

      if (!fulltext && !vector) {
        throw new Error("At least one of fulltext or vector must be provided");
      }

      if (indexes.has(name) || manifest.has(name)) {
        if (overwrite) {
          const old = indexes.get(name);
          if (old) await old.close();
          indexes.delete(name);
          manifest.delete(name);
          const prefix = sanitizePrefix(name);
          await db.exec(`DROP TABLE IF EXISTS idx_${prefix}_fts`);
          await db.exec(`DROP TABLE IF EXISTS idx_${prefix}_vec`);
          await db.exec(`DROP TABLE IF EXISTS idx_${prefix}_docs`);
          await db.query("DELETE FROM __indexer_manifest WHERE name = $1", [name]);
        } else {
          throw new Error(`Index "${name}" already exists`);
        }
      }

      const prefix = sanitizePrefix(name);
      const docsTable = await createDocsTable(prefix);

      const fts = fulltext
        ? new PGLiteFullTextIndex(db, prefix, docsTable, {
            language: fulltext.language,
            metadata: fulltext.metadata,
          })
        : null;

      const vec = vector
        ? new PGLiteVectorIndex(db, prefix, docsTable, {
            dimensionality: vector.dimensionality,
            model: vector.model,
            metadata: vector.metadata,
          })
        : null;

      if (fts) await fts.init();
      if (vec) await vec.init();

      const config = JSON.stringify({ fulltext, vector });
      await db.query("INSERT INTO __indexer_manifest (name, config) VALUES ($1, $2)", [
        name,
        config,
      ]);

      const index = PGLiteIndex(name, db, docsTable, fts, vec);
      indexes.set(name, index);
      manifest.set(name, { name });

      return index;
    },

    async getIndex(name: string): Promise<Index | null> {
      ensureOpen();
      if (indexes.has(name)) {
        return indexes.get(name) ?? null;
      }
      if (!manifest.has(name)) {
        return null;
      }

      const result = await db.query<{ config: string }>(
        "SELECT config FROM __indexer_manifest WHERE name = $1",
        [name],
      );
      if (result.rows.length === 0) return null;

      const config = JSON.parse(result.rows[0]?.config ?? "{}") as {
        fulltext?: { language: string; metadata?: Record<string, unknown> };
        vector?: {
          dimensionality: number;
          model: string;
          metadata?: Record<string, unknown>;
        };
      };

      const prefix = sanitizePrefix(name);
      const docsTable = await createDocsTable(prefix);

      const fts = config.fulltext
        ? new PGLiteFullTextIndex(db, prefix, docsTable, {
            language: config.fulltext.language,
            metadata: config.fulltext.metadata,
          })
        : null;

      const vec = config.vector
        ? new PGLiteVectorIndex(db, prefix, docsTable, {
            dimensionality: config.vector.dimensionality,
            model: config.vector.model,
            metadata: config.vector.metadata,
          })
        : null;

      const index = PGLiteIndex(name, db, docsTable, fts, vec);
      indexes.set(name, index);
      return index;
    },

    async hasIndex(name: string): Promise<boolean> {
      ensureOpen();
      return manifest.has(name);
    },

    async deleteIndex(name: string): Promise<void> {
      ensureOpen();
      const index = indexes.get(name);
      if (index) {
        await index.close();
        indexes.delete(name);
      }
      if (manifest.has(name)) {
        const prefix = sanitizePrefix(name);
        await db.exec(`DROP TABLE IF EXISTS idx_${prefix}_fts`);
        await db.exec(`DROP TABLE IF EXISTS idx_${prefix}_vec`);
        await db.exec(`DROP TABLE IF EXISTS idx_${prefix}_docs`);
        await db.query("DELETE FROM __indexer_manifest WHERE name = $1", [name]);
        manifest.delete(name);
      }
    },

    async flush(): Promise<void> {
      ensureOpen();
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const index of indexes.values()) {
        await index.close();
      }
      indexes.clear();
      manifest.clear();
      if (ownsDb) {
        await db.close();
      }
    },
  };

  return indexer;
}
