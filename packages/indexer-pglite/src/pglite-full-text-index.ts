import type { PGlite } from "@electric-sql/pglite";
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
  readonly tableName: string;
  private readonly docsTable: string;
  private readonly info: FullTextIndexInfo;
  private readonly pgLang: string;
  private closed = false;

  constructor(db: PGlite, prefix: string, docsTable: string, info: FullTextIndexInfo) {
    this.db = db;
    this.tableName = `idx_${prefix}_fts`;
    this.docsTable = docsTable;
    this.info = info;
    this.pgLang = resolvePgLanguage(info.language);
  }

  async init(): Promise<void> {
    await this.db.exec(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (doc_id INTEGER NOT NULL, block_id TEXT NOT NULL, content TEXT NOT NULL, content_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('${this.pgLang}', content)) STORED, metadata TEXT, PRIMARY KEY (doc_id, block_id))`,
    );
    await this.db.exec(
      `CREATE INDEX IF NOT EXISTS ${this.tableName}_tsv_idx ON ${this.tableName} USING GIN (content_tsv)`,
    );
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("FullTextIndex is closed");
    }
  }

  private async resolveDocId(path: DocumentPath): Promise<number> {
    await this.db.query(
      `INSERT INTO ${this.docsTable} (path) VALUES ($1) ON CONFLICT (path) DO NOTHING`,
      [path],
    );
    const { rows } = await this.db.query<{ doc_id: number }>(
      `SELECT doc_id FROM ${this.docsTable} WHERE path = $1`,
      [path],
    );
    return rows[0]?.doc_id ?? -1;
  }

  private pathFilterClause(
    paths: DocumentPath[] | undefined,
    paramOffset: number,
  ): { sql: string; params: string[] } {
    if (!paths || paths.length === 0) return { sql: "", params: [] };
    const conditions = paths.map((_, i) => `d.path LIKE $${paramOffset + i} || '%'`);
    return {
      sql: ` AND (${conditions.join(" OR ")})`,
      params: paths as string[],
    };
  }

  async getIndexInfo(): Promise<FullTextIndexInfo> {
    this.ensureOpen();
    return { ...this.info };
  }

  async *search(params: FullTextSearchParams): AsyncGenerator<FullTextSearchResult> {
    this.ensureOpen();
    const { queries, topK, paths } = params;

    if (!queries || queries.length === 0) return;

    const bestScores = new Map<string, FullTextSearchResult>();

    for (const query of queries) {
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 0)
        .map((w) => w.replace(/[^a-zA-Z0-9]/g, ""));
      const validWords = words.filter((w) => w.length > 0);
      if (validWords.length === 0) continue;

      const orTerms = validWords.join(" | ");

      const allParams: (string | number)[] = [orTerms];

      const pathFilter = this.pathFilterClause(paths, allParams.length + 1);
      allParams.push(...pathFilter.params);

      const topKParam = `$${allParams.length + 1}`;
      allParams.push(topK);

      const sql = `SELECT d.path, b.block_id, b.content, ts_rank_cd(b.content_tsv, to_tsquery('${this.pgLang}', $1)) AS score FROM ${this.tableName} b JOIN ${this.docsTable} d ON d.doc_id = b.doc_id WHERE b.content_tsv @@ to_tsquery('${this.pgLang}', $1)${pathFilter.sql} ORDER BY score DESC LIMIT ${topKParam}`;

      const { rows } = await this.db.query<{
        path: string;
        block_id: string;
        content: string;
        score: number;
      }>(sql, allParams);

      for (const row of rows) {
        const key = `${row.path}\0${row.block_id}`;
        const existing = bestScores.get(key);
        if (!existing || row.score > existing.score) {
          bestScores.set(key, {
            path: row.path as DocumentPath,
            blockId: row.block_id,
            snippet: row.content,
            score: row.score,
          });
        }
      }
    }

    const sorted = [...bestScores.values()].sort((a, b) => b.score - a.score);
    for (const r of sorted.slice(0, topK)) {
      yield r;
    }
  }

  async addDocument(blocks: FullTextBlock[]): Promise<void> {
    this.ensureOpen();
    for (const block of blocks) {
      const docId = await this.resolveDocId(block.path);
      const metaJson = block.metadata ? JSON.stringify(block.metadata) : null;
      await this.db.query(`DELETE FROM ${this.tableName} WHERE doc_id = $1 AND block_id = $2`, [
        docId,
        block.blockId,
      ]);
      await this.db.query(
        `INSERT INTO ${this.tableName} (doc_id, block_id, content, metadata) VALUES ($1, $2, $3, $4)`,
        [docId, block.blockId, block.content, metaJson],
      );
    }
  }

  async addDocuments(
    blocks: Iterable<FullTextBlock[]> | AsyncIterable<FullTextBlock[]>,
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
      const { rows } = await this.db.query<{ cnt: number | bigint }>(
        `SELECT COUNT(*) AS cnt FROM ${this.tableName} b JOIN ${this.docsTable} d ON d.doc_id = b.doc_id WHERE d.path LIKE $1 || '%'`,
        [pathPrefix],
      );
      return Number(rows[0]?.cnt ?? 0);
    }
    const { rows } = await this.db.query<{ cnt: number | bigint }>(
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
    const { rows } = await this.db.query<{ path: string }>(sql, params);
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
    const { rows } = await this.db.query<{ path: string; block_id: string }>(sql, params);
    for (const row of rows) {
      yield { path: row.path as DocumentPath, blockId: row.block_id };
    }
  }

  async *getDocumentsBlocks(pathPrefix?: DocumentPath): AsyncGenerator<FullTextBlock> {
    this.ensureOpen();
    const sql =
      pathPrefix !== undefined
        ? `SELECT d.path, b.block_id, b.content, b.metadata FROM ${this.tableName} b JOIN ${this.docsTable} d ON d.doc_id = b.doc_id WHERE d.path LIKE $1 || '%'`
        : `SELECT d.path, b.block_id, b.content, b.metadata FROM ${this.tableName} b JOIN ${this.docsTable} d ON d.doc_id = b.doc_id`;
    const params = pathPrefix !== undefined ? [pathPrefix] : [];
    const { rows } = await this.db.query<{
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
