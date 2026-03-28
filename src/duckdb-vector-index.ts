import type { Db } from "@repo/db";
import {
  type BlockId,
  buildCollectionClause,
  type CollectionFilter,
  type CollectionId,
  DEFAULT_COLLECTION,
  type SearchResult,
  type VectorIndex,
  type VectorIndexInfo,
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
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (collection_id TEXT NOT NULL DEFAULT '${DEFAULT_COLLECTION}', block_id TEXT NOT NULL, embedding FLOAT[${dim}] NOT NULL, PRIMARY KEY (collection_id, block_id))`,
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
    collections?: CollectionFilter;
  }): Promise<SearchResult[]> {
    this.ensureOpen();
    this.validateDimensionality(params.embedding);

    const dim = this.info.dimensionality;
    const vecLiteral = this.embeddingToSql(params.embedding);

    let collClause = "";
    const queryParams: (string | number | string[])[] = [vecLiteral];

    const collFilter = buildCollectionClause(params.collections, 2);
    if (collFilter) {
      collClause = `WHERE ${collFilter.sql} `;
      queryParams.push(...collFilter.params);
    }

    const topKParam = `$${queryParams.length + 1}`;
    queryParams.push(params.topK);

    const rows = await this.db.query<{
      block_id: string;
      collection_id: string;
      dist: number;
    }>(
      `SELECT block_id, collection_id, array_cosine_distance(embedding, $1::FLOAT[${dim}]) AS dist FROM ${this.tableName} ${collClause}ORDER BY dist ASC LIMIT ${topKParam}`,
      queryParams,
    );

    const includeCollectionId = params.collections !== undefined;
    return rows.map((row) => ({
      blockId: row.block_id,
      score: 1 - row.dist,
      ...(includeCollectionId ? { collectionId: row.collection_id } : {}),
    }));
  }

  async addDocument(params: {
    blockId: BlockId;
    embedding: Float32Array;
    collectionId?: CollectionId;
  }): Promise<void> {
    this.ensureOpen();
    this.validateDimensionality(params.embedding);

    const cid = params.collectionId ?? DEFAULT_COLLECTION;
    const dim = this.info.dimensionality;
    const vecLiteral = this.embeddingToSql(params.embedding);

    await this.db.query(
      `DELETE FROM ${this.tableName} WHERE collection_id = $1 AND block_id = $2`,
      [cid, params.blockId],
    );
    await this.db.query(
      `INSERT INTO ${this.tableName} (collection_id, block_id, embedding) VALUES ($1, $2, $3::FLOAT[${dim}])`,
      [cid, params.blockId, vecLiteral],
    );
  }

  async addDocuments(
    docs:
      | Iterable<{
          blockId: BlockId;
          embedding: Float32Array;
          collectionId?: CollectionId;
        }>
      | AsyncIterable<{
          blockId: BlockId;
          embedding: Float32Array;
          collectionId?: CollectionId;
        }>,
  ): Promise<void> {
    this.ensureOpen();
    for await (const doc of docs as AsyncIterable<{
      blockId: BlockId;
      embedding: Float32Array;
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
