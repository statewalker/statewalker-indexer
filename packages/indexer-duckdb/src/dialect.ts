import type { Db } from "@statewalker/db-api";
import type {
  SqlBackedDialect,
  SqlDb,
  SqlFtsDialect,
  SqlVectorDialect,
} from "@statewalker/indexer-core";

/** Adapt `@statewalker/db-api`'s `Db` to `@statewalker/indexer-core`'s minimal `SqlDb`. */
export function wrapDbAsSqlDb(db: Db): SqlDb {
  return {
    exec: (sql) => db.exec(sql),
    query: <T>(sql: string, params?: unknown[]) => db.query<T>(sql, params ?? []),
  };
}

function embeddingToLiteral(embedding: Float32Array): string {
  return `[${Array.from(embedding).join(",")}]`;
}

/**
 * DuckDB FTS dialect.
 *
 * Current implementation: LIKE-based scanning (word-count + rank-decay). Phase 8 replaces this with
 * the official `fts` community extension (BM25 via `PRAGMA create_fts_index` + `match_bm25`).
 */
export const duckdbFtsDialect: SqlFtsDialect = {
  createTableDdl({ tableName }) {
    return [
      `CREATE TABLE IF NOT EXISTS ${tableName} (doc_id INTEGER NOT NULL, block_id TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT, PRIMARY KEY (doc_id, block_id))`,
    ];
  },

  async search({ db, tableName, docsTable, query, paths, topK }) {
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    if (words.length === 0) return [];

    const likeParams = words.map((w) => `%${w}%`);
    const conditions = words.map((_, i) => `LOWER(b.content) LIKE $${i + 1}`);
    const scoreExpr = words
      .map((_, i) => `CASE WHEN LOWER(b.content) LIKE $${i + 1} THEN 1 ELSE 0 END`)
      .join(" + ");

    const allParams: unknown[] = [...likeParams];

    let pathClause = "";
    if (paths && paths.length > 0) {
      const pathOffset = allParams.length + 1;
      pathClause = ` AND (${paths.map((_, i) => `d.path LIKE $${pathOffset + i} || '%'`).join(" OR ")})`;
      allParams.push(...(paths as string[]));
    }

    const topKParam = `$${allParams.length + 1}`;
    allParams.push(topK);

    const sql = `SELECT d.path, b.block_id, b.content, (${scoreExpr}) AS match_count FROM ${tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id WHERE (${conditions.join(" OR ")})${pathClause} ORDER BY match_count DESC LIMIT ${topKParam}`;

    const rows = await db.query<{
      path: string;
      block_id: string;
      content: string;
      match_count: number;
    }>(sql, allParams);

    return rows.map((row, rank) => ({
      path: row.path as import("@statewalker/indexer-api").DocumentPath,
      blockId: row.block_id,
      content: row.content,
      score: (row.match_count / words.length) * (1 - rank / (rows.length + 1)),
    }));
  },
};

/**
 * DuckDB vector dialect.
 *
 * Uses the `vss` extension's HNSW index with `array_cosine_distance` for cosine ANN search.
 * Embeddings are currently bound as stringified array literals — Phase 9 switches to parameter-bound
 * driver-native arrays for correctness and ingest speed.
 */
export const duckdbVectorDialect: SqlVectorDialect = {
  createTableDdl({ tableName, indexName, info }) {
    const dim = info.dimensionality;
    return [
      `CREATE TABLE IF NOT EXISTS ${tableName} (doc_id INTEGER NOT NULL, block_id TEXT NOT NULL, embedding FLOAT[${dim}] NOT NULL, PRIMARY KEY (doc_id, block_id))`,
      `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} USING HNSW (embedding)`,
    ];
  },

  bindEmbedding: embeddingToLiteral,
  embeddingCastSuffix: (dim) => `::FLOAT[${dim}]`,

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
      `SELECT d.path, b.block_id, array_cosine_distance(b.embedding, $1${embeddingCastSuffix(dim)}) AS dist FROM ${tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id ${pathClause}ORDER BY dist ASC LIMIT ${topKParam}`,
      allParams,
    );

    return rows.map((row) => ({
      path: row.path as import("@statewalker/indexer-api").DocumentPath,
      blockId: row.block_id,
      score: 1 - row.dist,
    }));
  },

  decodeEmbedding(raw) {
    return new Float32Array(raw as number[]);
  },
};

/** Aggregate DuckDB dialect for `createSqlBackedIndexer`. */
export const duckdbDialect: SqlBackedDialect = {
  extensionInit: [
    "INSTALL vss; LOAD vss;",
    "SET hnsw_enable_experimental_persistence = true;",
  ],
  docsTableDdl(prefix) {
    return [
      `CREATE SEQUENCE IF NOT EXISTS idx_${prefix}_docs_seq START 1`,
      `CREATE TABLE IF NOT EXISTS idx_${prefix}_docs (doc_id INTEGER PRIMARY KEY DEFAULT(nextval('idx_${prefix}_docs_seq')), path TEXT NOT NULL UNIQUE)`,
    ];
  },
  extraCleanup(prefix) {
    return [`DROP SEQUENCE IF EXISTS idx_${prefix}_docs_seq`];
  },
  unionAliasSuffix: "",
  fts: duckdbFtsDialect,
  vec: duckdbVectorDialect,
};
