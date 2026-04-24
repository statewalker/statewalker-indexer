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

/**
 * DuckDB bindings for `FLOAT[dim]` columns go through the `@statewalker/db-duckdb-node` driver, which
 * does not currently wrap JS arrays as `DuckDBArrayValue`. We format the embedding as a SQL array
 * literal (locale-independent via `Number.prototype.toString`) and rely on the `$n::FLOAT[dim]` cast
 * to parse it back. Switching to native array binding is a follow-up when the driver supports it.
 */
function embeddingToLiteral(embedding: Float32Array): string {
  return `[${Array.from(embedding).join(",")}]`;
}

/**
 * DuckDB FTS stemmer map. DuckDB's `fts` extension accepts a stemmer name per Snowball; we map
 * ISO-639-1 language codes used at `FullTextIndexInfo.language` to the corresponding stemmer.
 * Unknown codes fall through to 'porter' as a generic fallback.
 */
const DUCKDB_STEMMER_MAP: Record<string, string> = {
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
};

function resolveDuckDbStemmer(lang: string): string {
  return DUCKDB_STEMMER_MAP[lang] ?? "porter";
}

/**
 * The `fts_main_<table>` schema that DuckDB's fts extension creates when we call `create_fts_index`.
 * Used in the BM25 search SQL.
 */
function ftsMainSchema(tableName: string): string {
  return `fts_main_${tableName}`;
}

/**
 * DuckDB FTS dialect using the official `fts` extension.
 *
 * The table adds a virtual `fts_id` column that concatenates `(doc_id, block_id)` — required because
 * `create_fts_index` takes a single-column identifier. The FTS index is (re)built lazily by the
 * retriever (first search after a write; also on flush) via the `rebuild` hook, because the
 * extension does not auto-update on INSERT/DELETE.
 */
export const duckdbFtsDialect: SqlFtsDialect = {
  createTableDdl({ tableName }) {
    return [
      `CREATE TABLE IF NOT EXISTS ${tableName} (doc_id INTEGER NOT NULL, block_id TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT, fts_id TEXT GENERATED ALWAYS AS (CAST(doc_id AS VARCHAR) || '_' || block_id) VIRTUAL, PRIMARY KEY (doc_id, block_id))`,
    ];
  },

  async rebuild({ db, tableName, info }) {
    const stemmer = resolveDuckDbStemmer(info.language);
    await db.exec(
      `PRAGMA create_fts_index('${tableName}', 'fts_id', 'content', stemmer='${stemmer}', stopwords='none', strip_accents=1, lower=1, overwrite=1)`,
    );
  },

  async search({ db, tableName, docsTable, query, paths, topK }) {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    const schema = ftsMainSchema(tableName);
    const allParams: unknown[] = [trimmed];

    let pathClause = "";
    if (paths && paths.length > 0) {
      const pathOffset = allParams.length + 1;
      pathClause = ` AND (${paths.map((_, i) => `d.path LIKE $${pathOffset + i} || '%'`).join(" OR ")})`;
      allParams.push(...(paths as string[]));
    }

    const topKParam = `$${allParams.length + 1}`;
    allParams.push(topK);

    const sql = `SELECT d.path, b.block_id, b.content, ${schema}.match_bm25(b.fts_id, $1) AS score FROM ${tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id WHERE ${schema}.match_bm25(b.fts_id, $1) IS NOT NULL${pathClause} ORDER BY score DESC LIMIT ${topKParam}`;

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
      // HNSW index with the cosine metric: required so `array_cosine_distance` searches actually
      // use the index. Without this option DuckDB's vss extension defaults to l2sq and the planner
      // falls back to a sequential scan for cosine queries.
      `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} USING HNSW (embedding) WITH (metric = 'cosine')`,
    ];
  },

  bindEmbedding: embeddingToLiteral,
  embeddingCastSuffix: (dim) => `::FLOAT[${dim}]`,

  async search({
    db,
    tableName,
    docsTable,
    queryEmbedding,
    paths,
    topK,
    info,
    bindEmbedding,
    embeddingCastSuffix,
  }) {
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
    "INSTALL fts; LOAD fts;",
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
