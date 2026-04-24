import type {
  BlockReference,
  DocumentPath,
  FullTextBlock,
  FullTextIndex,
  FullTextIndexInfo,
  FullTextSearchParams,
  FullTextSearchResult,
  Metadata,
  PathSelector,
} from "@statewalker/indexer-api";
import { toAsyncIterable } from "./async.js";
import { compositeKey } from "./composite-key.js";
import type { SqlDb } from "./sql-db.js";

/**
 * Per-dialect SQL hooks for a full-text sub-index.
 *
 * Only the table DDL and the search SQL differ between SQL backends; everything else (CRUD, path filters,
 * doc-id resolution, enumeration) is shared in {@link createSqlFtsRetriever}.
 */
export interface SqlFtsDialect {
  /**
   * DDL statements to create the FTS table and any auxiliary indexes. Runs once per sub-index on `init()`.
   * Each returned string is `exec()`'d in order.
   */
  createTableDdl(opts: { tableName: string; info: FullTextIndexInfo }): string[];

  /**
   * Optional hook to (re)build an external FTS index structure after ingest/delete. When set, the
   * retriever tracks a dirty flag (set on every write) and calls this lazily before `search` and on
   * `flush`. Dialects whose FTS is maintained automatically by the database (e.g. PGlite's `tsvector`)
   * leave this undefined.
   */
  rebuild?(opts: { db: SqlDb; tableName: string; info: FullTextIndexInfo }): Promise<void>;

  /**
   * Execute a lexical search for a single query string. The base iterates `queries[]` and merges by best score.
   */
  search(opts: {
    db: SqlDb;
    tableName: string;
    docsTable: string;
    info: FullTextIndexInfo;
    query: string;
    paths: DocumentPath[] | undefined;
    topK: number;
  }): Promise<Array<{ path: DocumentPath; blockId: string; content: string; score: number }>>;
}

export interface SqlFtsRetrieverOptions {
  db: SqlDb;
  prefix: string;
  docsTable: string;
  info: FullTextIndexInfo;
  dialect: SqlFtsDialect;
}

/**
 * SQL-backed `FullTextIndex` implementation shared by every SQL backend. Per-dialect differences are
 * supplied via {@link SqlFtsDialect}. Callers typically expose this as `XxxFullTextIndex` in their barrel.
 */
export function createSqlFtsRetriever(opts: SqlFtsRetrieverOptions): FullTextIndex & {
  readonly tableName: string;
  init(): Promise<void>;
} {
  const { db, prefix, docsTable, info, dialect } = opts;
  const tableName = `idx_${prefix}_fts`;
  let closed = false;
  // Start dirty: forces a rebuild on first search after `init()` or a reopen, covering both
  // brand-new tables and tables whose FTS index structure may be out of date.
  let dirty = dialect.rebuild != null;

  const ensureOpen = (): void => {
    if (closed) throw new Error("FullTextIndex is closed");
  };

  const ensureRebuilt = async (): Promise<void> => {
    if (!dialect.rebuild || !dirty) return;
    await dialect.rebuild({ db, tableName, info });
    dirty = false;
  };

  const resolveDocId = async (path: DocumentPath): Promise<number> => {
    await db.query(`INSERT INTO ${docsTable} (path) VALUES ($1) ON CONFLICT (path) DO NOTHING`, [
      path,
    ]);
    const rows = await db.query<{ doc_id: number }>(
      `SELECT doc_id FROM ${docsTable} WHERE path = $1`,
      [path],
    );
    return rows[0]?.doc_id ?? -1;
  };

  return {
    tableName,

    async init(): Promise<void> {
      for (const stmt of dialect.createTableDdl({ tableName, info })) {
        await db.exec(stmt);
      }
    },

    async getIndexInfo(): Promise<FullTextIndexInfo> {
      ensureOpen();
      return { ...info };
    },

    async *search(params: FullTextSearchParams): AsyncGenerator<FullTextSearchResult> {
      ensureOpen();
      const { queries, topK, paths } = params;
      if (!queries || queries.length === 0) return;

      await ensureRebuilt();

      const bestScores = new Map<string, FullTextSearchResult>();
      for (const query of queries) {
        const rows = await dialect.search({ db, tableName, docsTable, info, query, paths, topK });
        for (const row of rows) {
          const key = compositeKey(row.path, row.blockId);
          const existing = bestScores.get(key);
          if (!existing || row.score > existing.score) {
            bestScores.set(key, {
              path: row.path,
              blockId: row.blockId,
              snippet: row.content,
              score: row.score,
            });
          }
        }
      }

      const sorted = [...bestScores.values()].sort((a, b) => b.score - a.score);
      for (const r of sorted.slice(0, topK)) yield r;
    },

    async addDocument(blocks: FullTextBlock[]): Promise<void> {
      ensureOpen();
      for (const block of blocks) {
        const docId = await resolveDocId(block.path);
        const metaJson = block.metadata ? JSON.stringify(block.metadata) : null;
        await db.query(`DELETE FROM ${tableName} WHERE doc_id = $1 AND block_id = $2`, [
          docId,
          block.blockId,
        ]);
        await db.query(
          `INSERT INTO ${tableName} (doc_id, block_id, content, metadata) VALUES ($1, $2, $3, $4)`,
          [docId, block.blockId, block.content, metaJson],
        );
      }
      if (dialect.rebuild) dirty = true;
    },

    async addDocuments(
      blocks: Iterable<FullTextBlock[]> | AsyncIterable<FullTextBlock[]>,
    ): Promise<void> {
      ensureOpen();
      for await (const batch of blocks) await this.addDocument(batch);
    },

    async deleteDocuments(
      pathSelectors: PathSelector[] | AsyncIterable<PathSelector>,
    ): Promise<void> {
      ensureOpen();
      for await (const sel of toAsyncIterable(pathSelectors)) {
        if (sel.blockId !== undefined) {
          await db.query(
            `DELETE FROM ${tableName} WHERE doc_id IN (SELECT doc_id FROM ${docsTable} WHERE path = $1) AND block_id = $2`,
            [sel.path, sel.blockId],
          );
        } else {
          await db.query(
            `DELETE FROM ${tableName} WHERE doc_id IN (SELECT doc_id FROM ${docsTable} WHERE path LIKE $1 || '%')`,
            [sel.path],
          );
        }
      }
      if (dialect.rebuild) dirty = true;
    },

    async getSize(pathPrefix?: DocumentPath): Promise<number> {
      ensureOpen();
      if (pathPrefix !== undefined) {
        const rows = await db.query<{ cnt: number | bigint }>(
          `SELECT COUNT(*) AS cnt FROM ${tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id WHERE d.path LIKE $1 || '%'`,
          [pathPrefix],
        );
        return Number(rows[0]?.cnt ?? 0);
      }
      const rows = await db.query<{ cnt: number | bigint }>(
        `SELECT COUNT(*) AS cnt FROM ${tableName}`,
      );
      return Number(rows[0]?.cnt ?? 0);
    },

    async *getDocumentPaths(pathPrefix?: DocumentPath): AsyncGenerator<DocumentPath> {
      ensureOpen();
      const sql =
        pathPrefix !== undefined
          ? `SELECT DISTINCT d.path FROM ${tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id WHERE d.path LIKE $1 || '%'`
          : `SELECT DISTINCT d.path FROM ${tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id`;
      const params = pathPrefix !== undefined ? [pathPrefix] : [];
      const rows = await db.query<{ path: string }>(sql, params);
      for (const row of rows) yield row.path as DocumentPath;
    },

    async *getDocumentBlocksRefs(pathPrefix?: DocumentPath): AsyncGenerator<BlockReference> {
      ensureOpen();
      const sql =
        pathPrefix !== undefined
          ? `SELECT d.path, b.block_id FROM ${tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id WHERE d.path LIKE $1 || '%'`
          : `SELECT d.path, b.block_id FROM ${tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id`;
      const params = pathPrefix !== undefined ? [pathPrefix] : [];
      const rows = await db.query<{ path: string; block_id: string }>(sql, params);
      for (const row of rows) {
        yield { path: row.path as DocumentPath, blockId: row.block_id };
      }
    },

    async *getDocumentsBlocks(pathPrefix?: DocumentPath): AsyncGenerator<FullTextBlock> {
      ensureOpen();
      const sql =
        pathPrefix !== undefined
          ? `SELECT d.path, b.block_id, b.content, b.metadata FROM ${tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id WHERE d.path LIKE $1 || '%'`
          : `SELECT d.path, b.block_id, b.content, b.metadata FROM ${tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id`;
      const params = pathPrefix !== undefined ? [pathPrefix] : [];
      const rows = await db.query<{
        path: string;
        block_id: string;
        content: string;
        metadata: string | null;
      }>(sql, params);
      for (const row of rows) {
        yield {
          path: row.path as DocumentPath,
          blockId: row.block_id,
          content: row.content,
          metadata: row.metadata ? (JSON.parse(row.metadata) as Metadata) : undefined,
        };
      }
    },

    async close(_options?: { force?: boolean }): Promise<void> {
      closed = true;
    },

    async flush(): Promise<void> {
      ensureOpen();
      await ensureRebuilt();
    },

    async deleteIndex(): Promise<void> {
      ensureOpen();
      closed = true;
      await db.exec(`DROP TABLE IF EXISTS ${tableName}`);
    },
  };
}
