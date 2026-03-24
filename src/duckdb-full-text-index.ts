import type { Db } from "@repo/db";
import type {
  BlockId,
  FullTextIndex,
  FullTextIndexInfo,
  Metadata,
  SearchResult,
} from "@repo/indexer-api";

export class DuckDbFullTextIndex implements FullTextIndex {
  private readonly db: Db;
  private readonly tableName: string;
  private readonly info: FullTextIndexInfo;
  private closed = false;

  constructor(db: Db, prefix: string, info: FullTextIndexInfo) {
    this.db = db;
    this.tableName = `idx_${prefix}_fts`;
    this.info = info;
  }

  async init(): Promise<void> {
    await this.db.exec(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (block_id TEXT PRIMARY KEY, content TEXT NOT NULL, metadata TEXT)`,
    );
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("FullTextIndex is closed");
    }
  }

  async getIndexInfo(): Promise<FullTextIndexInfo> {
    this.ensureOpen();
    return { ...this.info };
  }

  async deleteIndex(): Promise<void> {
    this.ensureOpen();
    this.closed = true;
    await this.db.exec(`DROP TABLE IF EXISTS ${this.tableName}`);
  }

  async search(params: {
    query: string;
    topK: number;
  }): Promise<SearchResult[]> {
    this.ensureOpen();

    const words = params.query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0);

    if (words.length === 0) return [];

    // Build a query that counts how many words match
    const conditions = words.map((_, i) => `LOWER(content) LIKE $${i + 1}`);
    const likeParams = words.map((w) => `%${w}%`);

    // Count matching words for scoring
    const scoreExpr = words
      .map(
        (_, i) => `CASE WHEN LOWER(content) LIKE $${i + 1} THEN 1 ELSE 0 END`,
      )
      .join(" + ");

    const sql = `SELECT block_id, (${scoreExpr}) AS match_count FROM ${this.tableName} WHERE ${conditions.join(" OR ")} ORDER BY match_count DESC LIMIT $${words.length + 1}`;

    const rows = await this.db.query<{ block_id: string; match_count: number }>(
      sql,
      [...likeParams, params.topK],
    );

    return rows.map((row, rank) => ({
      blockId: row.block_id,
      score: (row.match_count / words.length) * (1 - rank / (rows.length + 1)),
    }));
  }

  async addDocument(params: {
    blockId: BlockId;
    content: string;
    metadata?: Metadata;
  }): Promise<void> {
    this.ensureOpen();
    const metaJson = params.metadata ? JSON.stringify(params.metadata) : null;

    // Use INSERT OR REPLACE pattern
    await this.db.query(`DELETE FROM ${this.tableName} WHERE block_id = $1`, [
      params.blockId,
    ]);
    await this.db.query(
      `INSERT INTO ${this.tableName} (block_id, content, metadata) VALUES ($1, $2, $3)`,
      [params.blockId, params.content, metaJson],
    );
  }

  async addDocuments(
    docs:
      | Iterable<{ blockId: BlockId; content: string; metadata?: Metadata }>
      | AsyncIterable<{
          blockId: BlockId;
          content: string;
          metadata?: Metadata;
        }>,
  ): Promise<void> {
    this.ensureOpen();
    for await (const doc of docs as AsyncIterable<{
      blockId: BlockId;
      content: string;
      metadata?: Metadata;
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
