import type { Db } from "@statewalker/db-api";
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

export class DuckDbVectorIndex implements EmbeddingIndex {
  private readonly db: Db;
  readonly tableName: string;
  private readonly indexName: string;
  private readonly docsTable: string;
  private readonly info: EmbeddingIndexInfo;
  private closed = false;

  constructor(db: Db, prefix: string, docsTable: string, info: EmbeddingIndexInfo) {
    this.db = db;
    this.tableName = `idx_${prefix}_vec`;
    this.indexName = `idx_${prefix}_vec_hnsw`;
    this.docsTable = docsTable;
    this.info = info;
  }

  async init(): Promise<void> {
    const dim = this.info.dimensionality;
    await this.db.exec(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (doc_id INTEGER NOT NULL, block_id TEXT NOT NULL, embedding FLOAT[${dim}] NOT NULL, PRIMARY KEY (doc_id, block_id))`,
    );
    await this.db.exec(
      `CREATE INDEX IF NOT EXISTS ${this.indexName} ON ${this.tableName} USING HNSW (embedding)`,
    );
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("EmbeddingIndex is closed");
    }
  }

  private validateDimensionality(embedding: Float32Array): void {
    if (embedding.length !== this.info.dimensionality) {
      throw new Error(
        `Expected dimensionality ${this.info.dimensionality}, got ${embedding.length}`,
      );
    }
  }

  private embeddingToSql(embedding: Float32Array): string {
    return `[${Array.from(embedding).join(",")}]`;
  }

  private async resolveDocId(path: DocumentPath): Promise<number> {
    await this.db.query(
      `INSERT INTO ${this.docsTable} (path) VALUES ($1) ON CONFLICT (path) DO NOTHING`,
      [path],
    );
    const rows = await this.db.query<{ doc_id: number }>(
      `SELECT doc_id FROM ${this.docsTable} WHERE path = $1`,
      [path],
    );
    return rows[0]?.doc_id ?? -1;
  }

  async getIndexInfo(): Promise<EmbeddingIndexInfo> {
    this.ensureOpen();
    return { ...this.info };
  }

  async *search(params: EmbeddingSearchParams): AsyncGenerator<EmbeddingSearchResult> {
    this.ensureOpen();
    const { embeddings, topK, paths } = params;

    if (!embeddings || embeddings.length === 0) return;

    const bestScores = new Map<string, EmbeddingSearchResult>();
    const dim = this.info.dimensionality;

    for (const queryEmb of embeddings) {
      this.validateDimensionality(queryEmb);
      const vecLiteral = this.embeddingToSql(queryEmb);

      let pathClause = "";
      const queryParams: (string | number)[] = [vecLiteral];

      if (paths && paths.length > 0) {
        const pathConditions = paths.map((_, i) => `d.path LIKE $${i + 2} || '%'`);
        pathClause = `WHERE ${pathConditions.join(" OR ")} `;
        queryParams.push(...(paths as string[]));
      }

      const topKParam = `$${queryParams.length + 1}`;
      queryParams.push(topK);

      const rows = await this.db.query<{
        path: string;
        block_id: string;
        dist: number;
      }>(
        `SELECT d.path, b.block_id, array_cosine_distance(b.embedding, $1::FLOAT[${dim}]) AS dist FROM ${this.tableName} b JOIN ${this.docsTable} d ON d.doc_id = b.doc_id ${pathClause}ORDER BY dist ASC LIMIT ${topKParam}`,
        queryParams,
      );

      for (const row of rows) {
        const key = `${row.path}\0${row.block_id}`;
        const score = 1 - row.dist;
        const existing = bestScores.get(key);
        if (!existing || score > existing.score) {
          bestScores.set(key, {
            path: row.path as DocumentPath,
            blockId: row.block_id,
            score,
          });
        }
      }
    }

    const sorted = [...bestScores.values()].sort((a, b) => b.score - a.score);
    for (const r of sorted.slice(0, topK)) {
      yield r;
    }
  }

  async addDocument(blocks: EmbeddingBlock[]): Promise<void> {
    this.ensureOpen();
    for (const block of blocks) {
      this.validateDimensionality(block.embedding);
      const docId = await this.resolveDocId(block.path);
      const dim = this.info.dimensionality;
      const vecLiteral = this.embeddingToSql(block.embedding);

      await this.db.query(`DELETE FROM ${this.tableName} WHERE doc_id = $1 AND block_id = $2`, [
        docId,
        block.blockId,
      ]);
      await this.db.query(
        `INSERT INTO ${this.tableName} (doc_id, block_id, embedding) VALUES ($1, $2, $3::FLOAT[${dim}])`,
        [docId, block.blockId, vecLiteral],
      );
    }
  }

  async addDocuments(
    blocks: Iterable<EmbeddingBlock[]> | AsyncIterable<EmbeddingBlock[]>,
  ): Promise<void> {
    this.ensureOpen();
    for await (const batch of blocks) {
      await this.addDocument(batch);
    }
  }

  async deleteDocuments(
    pathSelectors: PathSelector[] | AsyncIterable<PathSelector>,
  ): Promise<void> {
    this.ensureOpen();
    for await (const sel of pathSelectors as AsyncIterable<PathSelector>) {
      if (sel.blockId !== undefined) {
        await this.db.query(
          `DELETE FROM ${this.tableName} WHERE doc_id IN (SELECT doc_id FROM ${this.docsTable} WHERE path = $1) AND block_id = $2`,
          [sel.path, sel.blockId],
        );
      } else {
        await this.db.query(
          `DELETE FROM ${this.tableName} WHERE doc_id IN (SELECT doc_id FROM ${this.docsTable} WHERE path LIKE $1 || '%')`,
          [sel.path],
        );
      }
    }
  }

  async getSize(pathPrefix?: DocumentPath): Promise<number> {
    this.ensureOpen();
    if (pathPrefix !== undefined) {
      const rows = await this.db.query<{ cnt: number | bigint }>(
        `SELECT COUNT(*) AS cnt FROM ${this.tableName} b JOIN ${this.docsTable} d ON d.doc_id = b.doc_id WHERE d.path LIKE $1 || '%'`,
        [pathPrefix],
      );
      return Number(rows[0]?.cnt ?? 0);
    }
    const rows = await this.db.query<{ cnt: number | bigint }>(
      `SELECT COUNT(*) AS cnt FROM ${this.tableName}`,
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  async *getDocumentPaths(pathPrefix?: DocumentPath): AsyncGenerator<DocumentPath> {
    this.ensureOpen();
    const sql =
      pathPrefix !== undefined
        ? `SELECT DISTINCT d.path FROM ${this.tableName} b JOIN ${this.docsTable} d ON d.doc_id = b.doc_id WHERE d.path LIKE $1 || '%'`
        : `SELECT DISTINCT d.path FROM ${this.tableName} b JOIN ${this.docsTable} d ON d.doc_id = b.doc_id`;
    const params = pathPrefix !== undefined ? [pathPrefix] : [];
    const rows = await this.db.query<{ path: string }>(sql, params);
    for (const row of rows) {
      yield row.path as DocumentPath;
    }
  }

  async *getDocumentBlocksRefs(pathPrefix?: DocumentPath): AsyncGenerator<BlockReference> {
    this.ensureOpen();
    const sql =
      pathPrefix !== undefined
        ? `SELECT d.path, b.block_id FROM ${this.tableName} b JOIN ${this.docsTable} d ON d.doc_id = b.doc_id WHERE d.path LIKE $1 || '%'`
        : `SELECT d.path, b.block_id FROM ${this.tableName} b JOIN ${this.docsTable} d ON d.doc_id = b.doc_id`;
    const params = pathPrefix !== undefined ? [pathPrefix] : [];
    const rows = await this.db.query<{ path: string; block_id: string }>(sql, params);
    for (const row of rows) {
      yield { path: row.path as DocumentPath, blockId: row.block_id };
    }
  }

  async *getDocumentsBlocks(pathPrefix?: DocumentPath): AsyncGenerator<EmbeddingBlock> {
    this.ensureOpen();
    const sql =
      pathPrefix !== undefined
        ? `SELECT d.path, b.block_id, b.embedding FROM ${this.tableName} b JOIN ${this.docsTable} d ON d.doc_id = b.doc_id WHERE d.path LIKE $1 || '%'`
        : `SELECT d.path, b.block_id, b.embedding FROM ${this.tableName} b JOIN ${this.docsTable} d ON d.doc_id = b.doc_id`;
    const params = pathPrefix !== undefined ? [pathPrefix] : [];
    const rows = await this.db.query<{
      path: string;
      block_id: string;
      embedding: number[];
    }>(sql, params);
    for (const row of rows) {
      yield {
        path: row.path as DocumentPath,
        blockId: row.block_id,
        embedding: new Float32Array(row.embedding),
      };
    }
  }

  async close(_options?: { force?: boolean }): Promise<void> {
    this.closed = true;
  }

  async flush(): Promise<void> {
    this.ensureOpen();
  }

  async deleteIndex(): Promise<void> {
    this.ensureOpen();
    this.closed = true;
    await this.db.exec(`DROP TABLE IF EXISTS ${this.tableName}`);
  }
}
