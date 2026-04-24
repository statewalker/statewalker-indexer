import type { Db } from "@statewalker/db-api";
import type { DocumentPath, Index, Metadata } from "@statewalker/indexer-api";
import { createCompositeIndex } from "@statewalker/indexer-core";
import type { DuckDbFullTextIndex } from "./duckdb-full-text-index.js";
import type { DuckDbVectorIndex } from "./duckdb-vector-index.js";

/**
 * DuckDB-backed composite `Index`.
 *
 * @deprecated Use `createCompositeIndex` from `@statewalker/indexer-core` directly. Kept as a thin factory for one transitional release.
 */
export function DuckDbIndex(
  name: string,
  db: Db,
  docsTable: string,
  fts: DuckDbFullTextIndex | null,
  vec: DuckDbVectorIndex | null,
  metadata?: Metadata,
): Index {
  return createCompositeIndex({
    name,
    fts,
    vec,
    metadata,
    getSize: async (pathPrefix?: DocumentPath): Promise<number> => {
      if (fts !== null && vec !== null) {
        const pathClause = pathPrefix !== undefined ? ` WHERE d.path LIKE $1 || '%'` : "";
        const params = pathPrefix !== undefined ? [pathPrefix] : [];
        const sql = `SELECT COUNT(*) AS cnt FROM (SELECT b.doc_id, b.block_id FROM ${fts.tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id${pathClause} UNION SELECT b.doc_id, b.block_id FROM ${vec.tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id${pathClause})`;
        const rows = await db.query<{ cnt: number | bigint }>(sql, params);
        return Number(rows[0]?.cnt ?? 0);
      }
      if (fts !== null) return fts.getSize(pathPrefix);
      if (vec !== null) return vec.getSize(pathPrefix);
      return 0;
    },
    onDeleteIndex: async () => {
      await db.exec(`DROP TABLE IF EXISTS ${docsTable}`);
    },
  });
}
