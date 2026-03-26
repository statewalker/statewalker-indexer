import type { Db } from "@repo/db";
import {
  type BlockId,
  type CollectionFilter,
  type CollectionId,
  DEFAULT_COLLECTION,
  type FullTextIndex,
  type FullTextIndexInfo,
  type Metadata,
  type SearchResult,
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
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (collection_id TEXT NOT NULL DEFAULT '${DEFAULT_COLLECTION}', block_id TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT, PRIMARY KEY (collection_id, block_id))`,
    );
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("FullTextIndex is closed");
    }
  }

  private resolveCollections(filter?: CollectionFilter): CollectionId[] | null {
    if (filter === undefined) return null;
    return Array.isArray(filter) ? filter : [filter];
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
    collections?: CollectionFilter;
  }): Promise<SearchResult[]> {
    this.ensureOpen();

    const words = params.query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0);

    if (words.length === 0) return [];

    const colls = this.resolveCollections(params.collections);
    const likeParams = words.map((w) => `%${w}%`);

    const conditions = words.map((_, i) => `LOWER(content) LIKE $${i + 1}`);
    const scoreExpr = words
      .map(
        (_, i) => `CASE WHEN LOWER(content) LIKE $${i + 1} THEN 1 ELSE 0 END`,
      )
      .join(" + ");

    let collClause = "";
    const allParams: (string | number)[] = [...likeParams];

    if (colls) {
      const placeholders = colls.map((_, i) => `$${words.length + i + 1}`);
      collClause = ` AND collection_id IN (${placeholders.join(", ")})`;
      allParams.push(...colls);
    }

    const topKParam = `$${allParams.length + 1}`;
    allParams.push(params.topK);

    const sql = `SELECT block_id, collection_id, (${scoreExpr}) AS match_count FROM ${this.tableName} WHERE (${conditions.join(" OR ")})${collClause} ORDER BY match_count DESC LIMIT ${topKParam}`;

    const rows = await this.db.query<{
      block_id: string;
      collection_id: string;
      match_count: number;
    }>(sql, allParams);

    const includeCollectionId = params.collections !== undefined;
    return rows.map((row, rank) => ({
      blockId: row.block_id,
      score: (row.match_count / words.length) * (1 - rank / (rows.length + 1)),
      ...(includeCollectionId ? { collectionId: row.collection_id } : {}),
    }));
  }

  async addDocument(params: {
    blockId: BlockId;
    content: string;
    metadata?: Metadata;
    collectionId?: CollectionId;
  }): Promise<void> {
    this.ensureOpen();
    const cid = params.collectionId ?? DEFAULT_COLLECTION;
    const metaJson = params.metadata ? JSON.stringify(params.metadata) : null;

    await this.db.query(
      `DELETE FROM ${this.tableName} WHERE collection_id = $1 AND block_id = $2`,
      [cid, params.blockId],
    );
    await this.db.query(
      `INSERT INTO ${this.tableName} (collection_id, block_id, content, metadata) VALUES ($1, $2, $3, $4)`,
      [cid, params.blockId, params.content, metaJson],
    );
  }

  async addDocuments(
    docs:
      | Iterable<{
          blockId: BlockId;
          content: string;
          metadata?: Metadata;
          collectionId?: CollectionId;
        }>
      | AsyncIterable<{
          blockId: BlockId;
          content: string;
          metadata?: Metadata;
          collectionId?: CollectionId;
        }>,
  ): Promise<void> {
    this.ensureOpen();
    for await (const doc of docs as AsyncIterable<{
      blockId: BlockId;
      content: string;
      metadata?: Metadata;
      collectionId?: CollectionId;
    }>) {
      await this.addDocument(doc);
    }
  }

  async deleteDocument(
    blockId: BlockId,
    collectionId?: CollectionId,
  ): Promise<void> {
    this.ensureOpen();
    if (collectionId !== undefined) {
      await this.db.query(
        `DELETE FROM ${this.tableName} WHERE collection_id = $1 AND block_id = $2`,
        [collectionId, blockId],
      );
    } else {
      await this.db.query(`DELETE FROM ${this.tableName} WHERE block_id = $1`, [
        blockId,
      ]);
    }
  }

  async deleteDocuments(
    blockIds: Iterable<BlockId> | AsyncIterable<BlockId>,
    collectionId?: CollectionId,
  ): Promise<void> {
    this.ensureOpen();
    for await (const blockId of blockIds as AsyncIterable<BlockId>) {
      await this.deleteDocument(blockId, collectionId);
    }
  }

  async deleteCollection(collectionId: CollectionId): Promise<void> {
    this.ensureOpen();
    await this.db.query(
      `DELETE FROM ${this.tableName} WHERE collection_id = $1`,
      [collectionId],
    );
  }

  async hasDocument(
    blockId: BlockId,
    collectionId?: CollectionId,
  ): Promise<boolean> {
    this.ensureOpen();
    if (collectionId !== undefined) {
      const rows = await this.db.query<{ cnt: number | bigint }>(
        `SELECT COUNT(*) AS cnt FROM ${this.tableName} WHERE collection_id = $1 AND block_id = $2`,
        [collectionId, blockId],
      );
      return Number(rows[0]?.cnt ?? 0) > 0;
    }
    const rows = await this.db.query<{ cnt: number | bigint }>(
      `SELECT COUNT(*) AS cnt FROM ${this.tableName} WHERE block_id = $1`,
      [blockId],
    );
    return Number(rows[0]?.cnt ?? 0) > 0;
  }

  async getSize(collectionId?: CollectionId): Promise<number> {
    this.ensureOpen();
    if (collectionId !== undefined) {
      const rows = await this.db.query<{ cnt: number | bigint }>(
        `SELECT COUNT(*) AS cnt FROM ${this.tableName} WHERE collection_id = $1`,
        [collectionId],
      );
      return Number(rows[0]?.cnt ?? 0);
    }
    const rows = await this.db.query<{ cnt: number | bigint }>(
      `SELECT COUNT(*) AS cnt FROM ${this.tableName}`,
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  async getCollections(): Promise<CollectionId[]> {
    this.ensureOpen();
    const rows = await this.db.query<{ collection_id: string }>(
      `SELECT DISTINCT collection_id FROM ${this.tableName}`,
    );
    return rows.map((r) => r.collection_id);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
