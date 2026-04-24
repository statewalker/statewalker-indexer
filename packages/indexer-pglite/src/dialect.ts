import type { PGlite } from "@electric-sql/pglite";
import type {
  SqlBackedDialect,
  SqlDb,
  SqlFtsDialect,
  SqlVectorDialect,
} from "@statewalker/indexer-core";

/** Adapt `@electric-sql/pglite`'s `PGlite` to `@statewalker/indexer-core`'s minimal `SqlDb`. */
export function wrapDbAsSqlDb(db: PGlite): SqlDb {
  return {
    exec: (sql) => db.exec(sql).then(() => undefined),
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const { rows } = await db.query<T>(sql, params ?? []);
      return rows;
    },
  };
}

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

function embeddingToLiteral(embedding: Float32Array): string {
  return `[${Array.from(embedding).join(",")}]`;
}

/**
 * PGlite FTS dialect — uses native PostgreSQL TSVECTOR with a GIN index, `ts_rank_cd` scoring,
 * and `to_tsquery` with a language-specific stemmer.
 */
export const pgliteFtsDialect: SqlFtsDialect = {
  createTableDdl({ tableName, info }) {
    const pgLang = resolvePgLanguage(info.language);
    return [
      `CREATE TABLE IF NOT EXISTS ${tableName} (doc_id INTEGER NOT NULL, block_id TEXT NOT NULL, content TEXT NOT NULL, content_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('${pgLang}', content)) STORED, metadata TEXT, PRIMARY KEY (doc_id, block_id))`,
      `CREATE INDEX IF NOT EXISTS ${tableName}_tsv_idx ON ${tableName} USING GIN (content_tsv)`,
    ];
  },

  async search({ db, tableName, docsTable, info, query, paths, topK }) {
    const pgLang = resolvePgLanguage(info.language);
    const validWords = query
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^a-zA-Z0-9]/g, ""))
      .filter((w) => w.length > 0);
    if (validWords.length === 0) return [];

    const orTerms = validWords.join(" | ");

    const allParams: unknown[] = [orTerms];
    let pathClause = "";
    if (paths && paths.length > 0) {
      const pathOffset = allParams.length + 1;
      pathClause = ` AND (${paths.map((_, i) => `d.path LIKE $${pathOffset + i} || '%'`).join(" OR ")})`;
      allParams.push(...(paths as string[]));
    }

    const topKParam = `$${allParams.length + 1}`;
    allParams.push(topK);

    const sql = `SELECT d.path, b.block_id, b.content, ts_rank_cd(b.content_tsv, to_tsquery('${pgLang}', $1)) AS score FROM ${tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id WHERE b.content_tsv @@ to_tsquery('${pgLang}', $1)${pathClause} ORDER BY score DESC LIMIT ${topKParam}`;

    const rows = await db.query<{
      path: string;
      block_id: string;
      content: string;
      score: number;
    }>(sql, allParams);

    return rows.map((row) => ({
      path: row.path as import("@statewalker/indexer-api").DocumentPath,
      blockId: row.block_id,
      content: row.content,
      score: row.score,
    }));
  },
};

/**
 * PGlite vector dialect — uses pgvector's HNSW index with the `<=>` cosine-distance operator.
 * Embeddings are currently bound as stringified array literals — Phase 9 switches to parameter-bound
 * driver-native arrays.
 */
export const pgliteVectorDialect: SqlVectorDialect = {
  createTableDdl({ tableName, indexName, info }) {
    const dim = info.dimensionality;
    return [
      `CREATE TABLE IF NOT EXISTS ${tableName} (doc_id INTEGER NOT NULL, block_id TEXT NOT NULL, embedding vector(${dim}) NOT NULL, PRIMARY KEY (doc_id, block_id))`,
      `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} USING hnsw (embedding vector_cosine_ops)`,
    ];
  },

  bindEmbedding: embeddingToLiteral,
  embeddingCastSuffix: (dim) => `::vector(${dim})`,

  async search({ db, tableName, docsTable, queryEmbedding, paths, topK, info, bindEmbedding, embeddingCastSuffix }) {
    const vecLiteral = bindEmbedding(queryEmbedding);
    const dim = info.dimensionality;

    const allParams: unknown[] = [vecLiteral];
    let pathClause = "";
    if (paths && paths.length > 0) {
      const pathOffset = allParams.length + 1;
      pathClause = `WHERE ${paths.map((_, i) => `d.path LIKE $${pathOffset + i} || '%'`).join(" OR ")} `;
      allParams.push(...(paths as string[]));
    }

    const topKParam = `$${allParams.length + 1}`;
    allParams.push(topK);

    const rows = await db.query<{ path: string; block_id: string; dist: number }>(
      `SELECT d.path, b.block_id, (b.embedding <=> $1${embeddingCastSuffix(dim)}) AS dist FROM ${tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id ${pathClause}ORDER BY dist ASC LIMIT ${topKParam}`,
      allParams,
    );

    return rows.map((row) => ({
      path: row.path as import("@statewalker/indexer-api").DocumentPath,
      blockId: row.block_id,
      score: 1 - row.dist,
    }));
  },

  decodeEmbedding(raw) {
    // PGlite returns vector as a string "[1,2,3]".
    return new Float32Array(JSON.parse(raw as string) as number[]);
  },
};

/** Aggregate PGlite dialect for `createSqlBackedIndexer`. */
export const pgliteDialect: SqlBackedDialect = {
  extensionInit: ["CREATE EXTENSION IF NOT EXISTS vector"],
  docsTableDdl(prefix) {
    return [
      `CREATE TABLE IF NOT EXISTS idx_${prefix}_docs (doc_id SERIAL PRIMARY KEY, path TEXT NOT NULL UNIQUE)`,
    ];
  },
  unionAliasSuffix: " AS combined",
  fts: pgliteFtsDialect,
  vec: pgliteVectorDialect,
};
