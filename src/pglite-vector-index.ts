import type { PGlite } from "@electric-sql/pglite";
import type {
  BlockId,
  SearchResult,
  VectorIndex,
  VectorIndexInfo,
} from "@repo/indexer-api";

export class PGLiteVectorIndex implements VectorIndex {
  private readonly db: PGlite;
  private readonly tableName: string;
  private readonly info: VectorIndexInfo;
  private closed = false;

  constructor(db: PGlite, prefix: string, info: VectorIndexInfo) {
    this.db = db;
    this.tableName = `idx_${prefix}_vec`;
    this.info = info;
  }

  async init(): Promise<void> {
    const dim = this.info.dimensionality;
    await this.db.exec(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (
        block_id TEXT PRIMARY KEY,
        embedding vector(${dim}) NOT NULL
      )`,
    );
    await this.db.exec(
      `CREATE INDEX IF NOT EXISTS ${this.tableName}_hnsw
       ON ${this.tableName} USING hnsw (embedding vector_cosine_ops)`,
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

    const vecLiteral = this.embeddingToSql(params.embedding);
    const result = await this.db.query<{ block_id: string; score: number }>(
      `SELECT block_id, 1 - (embedding <=> $1::vector) AS score
       FROM ${this.tableName}
       ORDER BY embedding <=> $1::vector ASC
       LIMIT $2`,
      [vecLiteral, params.topK],
    );

    return result.rows.map((row) => ({
      blockId: row.block_id,
      score: row.score,
    }));
  }

  async addDocument(params: {
    blockId: BlockId;
    embedding: Float32Array;
  }): Promise<void> {
    this.ensureOpen();
    this.validateDimensionality(params.embedding);

    const vecLiteral = this.embeddingToSql(params.embedding);
    await this.db.query(
      `INSERT INTO ${this.tableName} (block_id, embedding)
       VALUES ($1, $2::vector)
       ON CONFLICT (block_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
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
    const result = await this.db.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM ${this.tableName} WHERE block_id = $1`,
      [blockId],
    );
    return Number(result.rows[0]?.cnt ?? 0) > 0;
  }

  async getSize(): Promise<number> {
    this.ensureOpen();
    const result = await this.db.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM ${this.tableName}`,
    );
    return Number(result.rows[0]?.cnt ?? 0);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
