import type {
  CreateIndexParams,
  DocumentPath,
  EmbeddingIndex,
  EmbeddingIndexInfo,
  FullTextIndex,
  FullTextIndexInfo,
  Index,
  Indexer,
  IndexInfo,
} from "@statewalker/indexer-api";
import { createCompositeIndex } from "./create-composite-index.js";
import type { SqlFtsDialect } from "./create-sql-fts-retriever.js";
import { createSqlFtsRetriever } from "./create-sql-fts-retriever.js";
import type { SqlVectorDialect } from "./create-sql-vector-retriever.js";
import { createSqlVectorRetriever } from "./create-sql-vector-retriever.js";
import { sanitizePrefix } from "./sanitize-prefix.js";
import type { SqlDb } from "./sql-db.js";

type FtsWithTable = FullTextIndex & { readonly tableName: string; init(): Promise<void> };
type VecWithTable = EmbeddingIndex & { readonly tableName: string; init(): Promise<void> };

/** Per-backend dialect aggregating the pieces that genuinely differ between SQL backends. */
export interface SqlBackedDialect {
  /** SQL strings to run once during init, after the manifest table is created. */
  extensionInit: string[];
  /** DDL for the per-index docs table. Returns one or more statements. */
  docsTableDdl(prefix: string): string[];
  /** Optional per-index cleanup SQL (e.g. dropping auxiliary sequences). Runs after the docs table is dropped. */
  extraCleanup?(prefix: string): string[];
  /** Suffix appended to the inner UNION subquery in the composite `getSize` SQL. PGlite requires ` AS combined`; DuckDB leaves it empty. */
  unionAliasSuffix: string;

  fts: SqlFtsDialect;
  vec: SqlVectorDialect;
}

export interface SqlBackedIndexerOptions {
  db: SqlDb;
  dialect: SqlBackedDialect;
  /** Optional finaliser invoked by `indexer.close()` — backends that own their `db` can close it here. */
  onClose?(): Promise<void>;
}

interface StoredConfig {
  fulltext?: FullTextIndexInfo;
  vector?: EmbeddingIndexInfo;
}

/**
 * Generic SQL-backed `Indexer` factory. Carries the manifest table, index-lifecycle SQL, and
 * composite-assembly shared by every SQL backend; defers all dialect-specific SQL to `opts.dialect`.
 *
 * Replaces the ~200 LOC factories in `indexer-duckdb` and `indexer-pglite`.
 */
export async function createSqlBackedIndexer(opts: SqlBackedIndexerOptions): Promise<Indexer> {
  const { db, dialect, onClose } = opts;
  const indexes = new Map<string, Index>();
  const manifest = new Map<string, IndexInfo>();
  let closed = false;

  for (const stmt of dialect.extensionInit) await db.exec(stmt);

  await db.exec(
    "CREATE TABLE IF NOT EXISTS __indexer_manifest (name TEXT PRIMARY KEY, config TEXT NOT NULL)",
  );

  const existing = await db.query<{ name: string; config: string }>(
    "SELECT name, config FROM __indexer_manifest",
  );
  for (const entry of existing) manifest.set(entry.name, { name: entry.name });

  function ensureOpen(): void {
    if (closed) throw new Error("Indexer is closed");
  }

  async function createDocsTable(prefix: string): Promise<string> {
    for (const stmt of dialect.docsTableDdl(prefix)) await db.exec(stmt);
    return `idx_${prefix}_docs`;
  }

  async function dropIndexTables(prefix: string): Promise<void> {
    await db.exec(`DROP TABLE IF EXISTS idx_${prefix}_fts`);
    await db.exec(`DROP TABLE IF EXISTS idx_${prefix}_vec`);
    await db.exec(`DROP TABLE IF EXISTS idx_${prefix}_docs`);
    if (dialect.extraCleanup) {
      for (const stmt of dialect.extraCleanup(prefix)) await db.exec(stmt);
    }
  }

  function buildIndex(
    name: string,
    docsTable: string,
    fts: FtsWithTable | null,
    vec: VecWithTable | null,
  ): Index {
    return createCompositeIndex({
      name,
      fts,
      vec,
      getSize: async (pathPrefix?: DocumentPath): Promise<number> => {
        if (fts !== null && vec !== null) {
          const pathClause = pathPrefix !== undefined ? ` WHERE d.path LIKE $1 || '%'` : "";
          const params = pathPrefix !== undefined ? [pathPrefix] : [];
          const sql = `SELECT COUNT(*) AS cnt FROM (SELECT b.doc_id, b.block_id FROM ${fts.tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id${pathClause} UNION SELECT b.doc_id, b.block_id FROM ${vec.tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id${pathClause})${dialect.unionAliasSuffix}`;
          const rows = await db.query<{ cnt: number | bigint }>(sql, params);
          return Number(rows[0]?.cnt ?? 0);
        }
        if (fts !== null) return fts.getSize(pathPrefix);
        if (vec !== null) return vec.getSize(pathPrefix);
        return 0;
      },
      onDeleteIndex: async () => {
        await db.exec(`DROP TABLE IF EXISTS ${docsTable}`);
      },
    });
  }

  return {
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
          await dropIndexTables(prefix);
          await db.query("DELETE FROM __indexer_manifest WHERE name = $1", [name]);
        } else {
          throw new Error(`Index "${name}" already exists`);
        }
      }

      const prefix = sanitizePrefix(name);
      const docsTable = await createDocsTable(prefix);

      const fts = fulltext
        ? createSqlFtsRetriever({ db, prefix, docsTable, info: fulltext, dialect: dialect.fts })
        : null;
      const vec = vector
        ? createSqlVectorRetriever({ db, prefix, docsTable, info: vector, dialect: dialect.vec })
        : null;

      if (fts) await fts.init();
      if (vec) await vec.init();

      await db.query("INSERT INTO __indexer_manifest (name, config) VALUES ($1, $2)", [
        name,
        JSON.stringify({ fulltext, vector }),
      ]);

      const index = buildIndex(name, docsTable, fts, vec);
      indexes.set(name, index);
      manifest.set(name, { name });
      return index;
    },

    async getIndex(name: string): Promise<Index | null> {
      ensureOpen();
      if (indexes.has(name)) return indexes.get(name) ?? null;
      if (!manifest.has(name)) return null;

      const rows = await db.query<{ config: string }>(
        "SELECT config FROM __indexer_manifest WHERE name = $1",
        [name],
      );
      if (rows.length === 0) return null;

      const config = JSON.parse(rows[0]?.config ?? "{}") as StoredConfig;

      const prefix = sanitizePrefix(name);
      const docsTable = await createDocsTable(prefix);

      const fts = config.fulltext
        ? createSqlFtsRetriever({
            db,
            prefix,
            docsTable,
            info: config.fulltext,
            dialect: dialect.fts,
          })
        : null;
      const vec = config.vector
        ? createSqlVectorRetriever({
            db,
            prefix,
            docsTable,
            info: config.vector,
            dialect: dialect.vec,
          })
        : null;

      const index = buildIndex(name, docsTable, fts, vec);
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
        await dropIndexTables(prefix);
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
      for (const index of indexes.values()) await index.close();
      indexes.clear();
      manifest.clear();
      if (onClose) await onClose();
    },
  };
}
