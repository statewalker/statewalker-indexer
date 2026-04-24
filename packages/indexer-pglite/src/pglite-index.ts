import type { PGlite } from "@electric-sql/pglite";
import type { DocumentPath, Index, Metadata } from "@statewalker/indexer-api";
import { createCompositeIndex } from "@statewalker/indexer-core";
import type { PGLiteFullTextIndex } from "./pglite-full-text-index.js";
import type { PGLiteVectorIndex } from "./pglite-vector-index.js";

/**
 * PGlite-backed composite `Index`.
 *
 * @deprecated Use `createCompositeIndex` from `@statewalker/indexer-core` directly. Kept as a thin factory for one transitional release.
 */
export function PGLiteIndex(
  name: string,
  db: PGlite,
  docsTable: string,
  fts: PGLiteFullTextIndex | null,
  vec: PGLiteVectorIndex | null,
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
        const sql = `SELECT COUNT(*) AS cnt FROM (SELECT b.doc_id, b.block_id FROM ${fts.tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id${pathClause} UNION SELECT b.doc_id, b.block_id FROM ${vec.tableName} b JOIN ${docsTable} d ON d.doc_id = b.doc_id${pathClause}) AS combined`;
        const { rows } = await db.query<{ cnt: number | bigint }>(sql, params);
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
