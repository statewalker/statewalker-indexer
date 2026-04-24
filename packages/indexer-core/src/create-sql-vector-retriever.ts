import type {
  BlockReference,
  DocumentPath,
  EmbeddingBlock,
  EmbeddingIndex,
  EmbeddingIndexInfo,
  EmbeddingSearchParams,
  EmbeddingSearchResult,
  PathSelector,
} from "@statewalker/indexer-api";
import { toAsyncIterable } from "./async.js";
import { compositeKey } from "./composite-key.js";
import type { SqlDb } from "./sql-db.js";
import { validateDimensionality } from "./validate-dimensionality.js";

/**
 * Per-dialect SQL hooks for a vector sub-index.
 *
 * Only the table/HNSW DDL, the search SQL, embedding binding strategy, and the embedding-row decode
 * differ between SQL backends; everything else (CRUD, path filters, doc-id resolution, enumeration)
 * is shared in {@link createSqlVectorRetriever}.
 */
export interface SqlVectorDialect {
  /**
   * DDL statements to create the vector table and its HNSW index. Runs once per sub-index on `init()`.
   */
  createTableDdl(opts: {
    tableName: string;
    indexName: string;
    info: EmbeddingIndexInfo;
  }): string[];

  /** Driver-native binding for an embedding value used in INSERT / SELECT parameter slots. */
  bindEmbedding(embedding: Float32Array): unknown;

  /**
   * The SQL cast suffix for the embedding param; e.g. `::FLOAT[1536]` (DuckDB) or `::vector(1536)` (PGlite).
   * Appended to the embedding parameter placeholder in INSERT and search SQL.
   */
  embeddingCastSuffix(dim: number): string;

  /** Execute a cosine/ANN search for a single query vector. The base iterates embeddings and merges by best score. */
  search(opts: {
    db: SqlDb;
    tableName: string;
    docsTable: string;
    queryEmbedding: Float32Array;
    paths: DocumentPath[] | undefined;
    topK: number;
    info: EmbeddingIndexInfo;
    bindEmbedding(embedding: Float32Array): unknown;
    embeddingCastSuffix(dim: number): string;
  }): Promise<Array<{ path: DocumentPath; blockId: string; score: number }>>;

  /** Driver-specific decode of a raw embedding column value from a SELECT row into a Float32Array. */
  decodeEmbedding(raw: unknown): Float32Array;
}

export interface SqlVectorRetrieverOptions {
  db: SqlDb;
  prefix: string;
  docsTable: string;
  info: EmbeddingIndexInfo;
  dialect: SqlVectorDialect;
}

/**
 * SQL-backed `EmbeddingIndex` implementation shared by every SQL backend. Per-dialect differences are
 * supplied via {@link SqlVectorDialect}. Callers typically expose this as `XxxVectorIndex` in their barrel.
 */
export function createSqlVectorRetriever(opts: SqlVectorRetrieverOptions): EmbeddingIndex & {
  readonly tableName: string;
  init(): Promise<void>;
} {
  const { db, prefix, docsTable, info, dialect } = opts;
  const tableName = `idx_${prefix}_vec`;
  const indexName = `idx_${prefix}_vec_hnsw`;
  const dim = info.dimensionality;
  let closed = false;

  const ensureOpen = (): void => {
    if (closed) throw new Error("EmbeddingIndex is closed");
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
      for (const stmt of dialect.createTableDdl({ tableName, indexName, info })) {
        await db.exec(stmt);
      }
    },

    async getIndexInfo(): Promise<EmbeddingIndexInfo> {
      ensureOpen();
      return { ...info };
    },

    async *search(params: EmbeddingSearchParams): AsyncGenerator<EmbeddingSearchResult> {
      ensureOpen();
      const { embeddings, topK, paths } = params;
      if (!embeddings || embeddings.length === 0) return;

      const bestScores = new Map<string, EmbeddingSearchResult>();

      for (const queryEmb of embeddings) {
        validateDimensionality(info, queryEmb);
        const rows = await dialect.search({
          db,
          tableName,
          docsTable,
          queryEmbedding: queryEmb,
          paths,
          topK,
          info,
          bindEmbedding: dialect.bindEmbedding,
          embeddingCastSuffix: dialect.embeddingCastSuffix,
        });
        for (const row of rows) {
          const key = compositeKey(row.path, row.blockId);
          const existing = bestScores.get(key);
          if (!existing || row.score > existing.score) {
            bestScores.set(key, {
              path: row.path,
              blockId: row.blockId,
              score: row.score,
            });
          }
        }
      }

      const sorted = [...bestScores.values()].sort((a, b) => b.score - a.score);
      for (const r of sorted.slice(0, topK)) yield r;
    },

    async addDocument(blocks: EmbeddingBlock[]): Promise<void> {
      ensureOpen();
      for (const block of blocks) {
        validateDimensionality(info, block.embedding);
        const docId = await resolveDocId(block.path);
        const bound = dialect.bindEmbedding(block.embedding);
        const cast = dialect.embeddingCastSuffix(dim);

        await db.query(`DELETE FROM ${tableName} WHERE doc_id = $1 AND block_id = $2`, [
          docId,
          block.blockId,
        ]);
        await db.query(
          `INSERT INTO ${tableName} (doc_id, block_id, embedding) VALUES ($1, $2, $3${cast})`,
          [docId, block.blockId, bound],
        );
      }
    },

    async addDocuments(
      blocks: Iterable<EmbeddingBlock[]> | AsyncIterable<EmbeddingBlock[]>,
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

    async *getDocumentsBlocks(pathPrefix?: DocumentPath): AsyncGenerator<EmbeddingBlock> {
      ensureOpen();
      const sql =
        pathPrefix !== undefined
          ? `SELECT d.path, b.block_id, b.embedding FROM ${tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id WHERE d.path LIKE $1 || '%'`
          : `SELECT d.path, b.block_id, b.embedding FROM ${tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id`;
      const params = pathPrefix !== undefined ? [pathPrefix] : [];
      const rows = await db.query<{
        path: string;
        block_id: string;
        embedding: unknown;
      }>(sql, params);
      for (const row of rows) {
        yield {
          path: row.path as DocumentPath,
          blockId: row.block_id,
          embedding: dialect.decodeEmbedding(row.embedding),
        };
      }
    },

    async close(_options?: { force?: boolean }): Promise<void> {
      closed = true;
    },

    async flush(): Promise<void> {
      ensureOpen();
    },

    async deleteIndex(): Promise<void> {
      ensureOpen();
      closed = true;
      await db.exec(`DROP TABLE IF EXISTS ${tableName}`);
    },
  };
}
