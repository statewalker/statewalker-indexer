import type { PGlite } from "@electric-sql/pglite";
import type {
  BlockId,
  FullTextIndex,
  FullTextIndexInfo,
  Metadata,
  SearchResult,
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
    // Language config must be a literal in the SQL for GENERATED ALWAYS AS
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        block_id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        content_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('${this.pgLang}', content)) STORED,
        metadata TEXT
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

    const trimmed = params.query.trim();
    if (trimmed.length === 0) return [];

    // Split into words and join with OR (|) for flexible matching.
    const words = trimmed
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .map((w) => w.replace(/[^a-zA-Z0-9]/g, ""));
    const validWords = words.filter((w) => w.length > 0);
    if (validWords.length === 0) return [];

    const orTerms = validWords.join(" | ");

    const result = await this.db.query<{ block_id: string; score: number }>(
      `SELECT block_id, ts_rank_cd(content_tsv, to_tsquery('${this.pgLang}', $1)) AS score
       FROM ${this.tableName}
       WHERE content_tsv @@ to_tsquery('${this.pgLang}', $1)
       ORDER BY score DESC
       LIMIT $2`,
      [orTerms, params.topK],
    );

    return result.rows.map((row) => ({
      blockId: row.block_id,
      score: row.score,
    }));
  }

  async addDocument(params: {
    blockId: BlockId;
    content: string;
    metadata?: Metadata;
  }): Promise<void> {
    this.ensureOpen();
    const metaJson = params.metadata ? JSON.stringify(params.metadata) : null;

    await this.db.query(
      `INSERT INTO ${this.tableName} (block_id, content, metadata)
       VALUES ($1, $2, $3)
       ON CONFLICT (block_id) DO UPDATE SET content = EXCLUDED.content, metadata = EXCLUDED.metadata`,
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
