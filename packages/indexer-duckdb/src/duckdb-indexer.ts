import type { Db } from "@statewalker/db-api";
import type { CreateIndexParams, Index, Indexer, IndexInfo } from "@statewalker/indexer-api";
import { sanitizePrefix } from "@statewalker/indexer-core";
import { DuckDbFullTextIndex } from "./duckdb-full-text-index.js";
import { DuckDbIndex } from "./duckdb-index.js";
import { DuckDbVectorIndex } from "./duckdb-vector-index.js";

export interface DuckDbIndexerOptions {
  db: Db;
}

export async function createDuckDbIndexer(options: DuckDbIndexerOptions): Promise<Indexer> {
  const { db } = options;
  const indexes = new Map<string, Index>();
  const manifest = new Map<string, IndexInfo>();
  let closed = false;

  await db.exec("INSTALL vss; LOAD vss;");
  await db.exec("SET hnsw_enable_experimental_persistence = true;");

  await db.exec(
    "CREATE TABLE IF NOT EXISTS __indexer_manifest (name TEXT PRIMARY KEY, config TEXT NOT NULL)",
  );

  const existingEntries = await db.query<{ name: string; config: string }>(
    "SELECT name, config FROM __indexer_manifest",
  );
  for (const entry of existingEntries) {
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
      `CREATE TABLE IF NOT EXISTS ${docsTable} (doc_id INTEGER PRIMARY KEY DEFAULT(nextval('${docsTable}_seq')), path TEXT NOT NULL UNIQUE)`,
    );
    return docsTable;
  }

  async function ensureDocsSequence(prefix: string): Promise<void> {
    const seqName = `idx_${prefix}_docs_seq`;
    await db.exec(`CREATE SEQUENCE IF NOT EXISTS ${seqName} START 1`);
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
          await db.exec(`DROP SEQUENCE IF EXISTS idx_${prefix}_docs_seq`);
          await db.exec(
            `DELETE FROM __indexer_manifest WHERE name = '${name.replace(/'/g, "''")}'`,
          );
        } else {
          throw new Error(`Index "${name}" already exists`);
        }
      }

      const prefix = sanitizePrefix(name);
      await ensureDocsSequence(prefix);
      const docsTable = await createDocsTable(prefix);

      const fts = fulltext
        ? new DuckDbFullTextIndex(db, prefix, docsTable, {
            language: fulltext.language,
            metadata: fulltext.metadata,
          })
        : null;

      const vec = vector
        ? new DuckDbVectorIndex(db, prefix, docsTable, {
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

      const index = DuckDbIndex(name, db, docsTable, fts, vec);
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

      const rows = await db.query<{ config: string }>(
        "SELECT config FROM __indexer_manifest WHERE name = $1",
        [name],
      );
      if (rows.length === 0) return null;

      const config = JSON.parse(rows[0]?.config ?? "{}") as {
        fulltext?: { language: string; metadata?: Record<string, unknown> };
        vector?: {
          dimensionality: number;
          model: string;
          metadata?: Record<string, unknown>;
        };
      };

      const prefix = sanitizePrefix(name);
      await ensureDocsSequence(prefix);
      const docsTable = await createDocsTable(prefix);

      const fts = config.fulltext
        ? new DuckDbFullTextIndex(db, prefix, docsTable, {
            language: config.fulltext.language,
            metadata: config.fulltext.metadata,
          })
        : null;

      const vec = config.vector
        ? new DuckDbVectorIndex(db, prefix, docsTable, {
            dimensionality: config.vector.dimensionality,
            model: config.vector.model,
            metadata: config.vector.metadata,
          })
        : null;

      const index = DuckDbIndex(name, db, docsTable, fts, vec);
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
        await db.exec(`DROP SEQUENCE IF EXISTS idx_${prefix}_docs_seq`);
        await db.exec(`DELETE FROM __indexer_manifest WHERE name = '${name.replace(/'/g, "''")}'`);
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
    },
  };

  return indexer;
}
