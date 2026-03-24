import type { Db } from "@repo/db";
import type {
  BlockId,
  SearchResult,
  VectorIndex,
  VectorIndexInfo,
} from "@repo/indexer-api";

export class DuckDbVectorIndex implements VectorIndex {
  private readonly db: Db;
  private readonly tableName: string;
  private readonly indexName: string;
  private readonly info: VectorIndexInfo;
  private closed = false;

  constructor(db: Db, prefix: string, info: VectorIndexInfo) {
    this.db = db;
    this.tableName = `idx_${prefix}_vec`;
    this.indexName = `idx_${prefix}_vec_hnsw`;
    this.info = info;
  }

  async init(): Promise<void> {
    const dim = this.info.dimensionality;
    await this.db.exec(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (block_id TEXT PRIMARY KEY, embedding FLOAT[${dim}] NOT NULL)`,
    );
    await this.db.exec(
      `CREATE INDEX IF NOT EXISTS ${this.indexName} ON ${this.tableName} USING HNSW (embedding)`,
    );
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("VectorIndex is closed");
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

  async getIndexInfo(): Promise<VectorIndexInfo> {
    this.ensureOpen();
    return { ...this.info };
  }

  async deleteIndex(): Promise<void> {
    this.ensureOpen();
    this.closed = true;
    await this.db.exec(`DROP TABLE IF EXISTS ${this.tableName}`);
  }

  async search(params: {
    topK: number;
    embedding: Float32Array;
  }): Promise<SearchResult[]> {
    this.ensureOpen();
    this.validateDimensionality(params.embedding);

    const dim = this.info.dimensionality;
    const vecLiteral = this.embeddingToSql(params.embedding);
    const rows = await this.db.query<{ block_id: string; dist: number }>(
      `SELECT block_id, array_cosine_distance(embedding, $1::FLOAT[${dim}]) AS dist FROM ${this.tableName} ORDER BY dist ASC LIMIT $2`,
      [vecLiteral, params.topK],
    );

    return rows.map((row) => ({
      blockId: row.block_id,
      score: 1 - row.dist,
    }));
  }

  async addDocument(params: {
    blockId: BlockId;
    embedding: Float32Array;
  }): Promise<void> {
    this.ensureOpen();
    this.validateDimensionality(params.embedding);

    const dim = this.info.dimensionality;
    const vecLiteral = this.embeddingToSql(params.embedding);

    await this.db.query(`DELETE FROM ${this.tableName} WHERE block_id = $1`, [
      params.blockId,
    ]);
    await this.db.query(
      `INSERT INTO ${this.tableName} (block_id, embedding) VALUES ($1, $2::FLOAT[${dim}])`,
      [params.blockId, vecLiteral],
    );
  }

  async addDocuments(
    docs:
      | Iterable<{ blockId: BlockId; embedding: Float32Array }>
      | AsyncIterable<{ blockId: BlockId; embedding: Float32Array }>,
  ): Promise<void> {
    this.ensureOpen();
    for await (const doc of docs as AsyncIterable<{
      blockId: BlockId;
      embedding: Float32Array;
    }>) {
      await this.addDocument(doc);
    }
  }

  async deleteDocument(blockId: BlockId): Promise<void> {
    this.ensureOpen();
    await this.db.query(`DELETE FROM ${this.tableName} WHERE block_id = $1`, [
      blockId,
    ]);
  }

  async deleteDocuments(
    blockIds: Iterable<BlockId> | AsyncIterable<BlockId>,
  ): Promise<void> {
    this.ensureOpen();
    for await (const blockId of blockIds as AsyncIterable<BlockId>) {
      await this.deleteDocument(blockId);
    }
  }

  async hasDocument(blockId: BlockId): Promise<boolean> {
    this.ensureOpen();
    const rows = await this.db.query<{ cnt: number | bigint }>(
      `SELECT COUNT(*) AS cnt FROM ${this.tableName} WHERE block_id = $1`,
      [blockId],
    );
    return Number(rows[0]?.cnt ?? 0) > 0;
  }

  async getSize(): Promise<number> {
    this.ensureOpen();
    const rows = await this.db.query<{ cnt: number | bigint }>(
      `SELECT COUNT(*) AS cnt FROM ${this.tableName}`,
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
