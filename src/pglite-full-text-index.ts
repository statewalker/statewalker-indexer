import type { PGlite } from "@electric-sql/pglite";
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

const LANGUAGE_MAP: Record<string, string> = {
  en: "english",
  fr: "french",
  de: "german",
  es: "spanish",
  it: "italian",
  pt: "portuguese",
  nl: "dutch",
  ru: "russian",
  sv: "swedish",
  no: "norwegian",
  da: "danish",
  fi: "finnish",
  hu: "hungarian",
  ro: "romanian",
  tr: "turkish",
  simple: "simple",
};

function resolvePgLanguage(lang: string): string {
  return LANGUAGE_MAP[lang] ?? lang;
}

export class PGLiteFullTextIndex implements FullTextIndex {
  private readonly db: PGlite;
  private readonly tableName: string;
  private readonly info: FullTextIndexInfo;
  private readonly pgLang: string;
  private closed = false;

  constructor(db: PGlite, prefix: string, info: FullTextIndexInfo) {
    this.db = db;
    this.tableName = `idx_${prefix}_fts`;
    this.info = info;
    this.pgLang = resolvePgLanguage(info.language);
  }

  async init(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        collection_id TEXT NOT NULL DEFAULT '${DEFAULT_COLLECTION}',
        block_id TEXT NOT NULL,
        content TEXT NOT NULL,
        content_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('${this.pgLang}', content)) STORED,
        metadata TEXT,
        PRIMARY KEY (collection_id, block_id)
      )
    `);
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS ${this.tableName}_tsv_idx ON ${this.tableName} USING GIN (content_tsv)
    `);
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

    const trimmed = params.query.trim();
    if (trimmed.length === 0) return [];

    const words = trimmed
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .map((w) => w.replace(/[^a-zA-Z0-9]/g, ""));
    const validWords = words.filter((w) => w.length > 0);
    if (validWords.length === 0) return [];

    const orTerms = validWords.join(" | ");
    const colls = this.resolveCollections(params.collections);

    let collClause = "";
    const queryParams: (string | number | string[])[] = [orTerms];

    if (colls) {
      collClause = ` AND collection_id = ANY($3::text[])`;
      queryParams.push(params.topK, colls);
    } else {
      queryParams.push(params.topK);
    }

    const includeCollectionId = params.collections !== undefined;

    const result = await this.db.query<{
      block_id: string;
      collection_id: string;
      score: number;
    }>(
      `SELECT block_id, collection_id, ts_rank_cd(content_tsv, to_tsquery('${this.pgLang}', $1)) AS score
       FROM ${this.tableName}
       WHERE content_tsv @@ to_tsquery('${this.pgLang}', $1)${collClause}
       ORDER BY score DESC
       LIMIT $2`,
      queryParams,
    );

    return result.rows.map((row) => ({
      blockId: row.block_id,
      score: row.score,
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
      `INSERT INTO ${this.tableName} (collection_id, block_id, content, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (collection_id, block_id) DO UPDATE SET content = EXCLUDED.content, metadata = EXCLUDED.metadata`,
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
      const result = await this.db.query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM ${this.tableName} WHERE collection_id = $1 AND block_id = $2`,
        [collectionId, blockId],
      );
      return Number(result.rows[0]?.cnt ?? 0) > 0;
    }
    const result = await this.db.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM ${this.tableName} WHERE block_id = $1`,
      [blockId],
    );
    return Number(result.rows[0]?.cnt ?? 0) > 0;
  }

  async getSize(collectionId?: CollectionId): Promise<number> {
    this.ensureOpen();
    if (collectionId !== undefined) {
      const result = await this.db.query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM ${this.tableName} WHERE collection_id = $1`,
        [collectionId],
      );
      return Number(result.rows[0]?.cnt ?? 0);
    }
    const result = await this.db.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM ${this.tableName}`,
    );
    return Number(result.rows[0]?.cnt ?? 0);
  }

  async getCollections(): Promise<CollectionId[]> {
    this.ensureOpen();
    const result = await this.db.query<{ collection_id: string }>(
      `SELECT DISTINCT collection_id FROM ${this.tableName}`,
    );
    return result.rows.map((r) => r.collection_id);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
