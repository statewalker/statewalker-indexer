import type { Db } from "@statewalker/db-api";
import type { BlockReference, DocumentPath } from "@statewalker/indexer-api";
import type { BlockIds } from "./block-ids.js";
import { pathPrefixSql } from "./path-sql.js";

export interface BlockEntry extends BlockReference {
  id: number;
}

/** `SearchIndex` enumeration over a sub-index's member ids joined with the blocks table. */
export interface Enumeration {
  size(prefix?: DocumentPath): Promise<number>;
  entries(prefix?: DocumentPath): Promise<BlockEntry[]>;
  paths(prefix?: DocumentPath): AsyncGenerator<DocumentPath>;
  refs(prefix?: DocumentPath): AsyncGenerator<BlockReference>;
}

/** `memberIdsSql` is a `SELECT … AS id` listing the sub-index's ids, e.g. `SELECT rowid AS id FROM t`. */
export function newEnumeration(db: Db, blockIds: BlockIds, memberIdsSql: string): Enumeration {
  const from = (prefix?: DocumentPath) => {
    const scope = pathPrefixSql("b.path", prefix ? [prefix] : []);
    return {
      sql: `FROM (${memberIdsSql}) m JOIN ${blockIds.table} b ON b.id = m.id WHERE ${scope.sql}`,
      params: scope.params,
    };
  };
  return {
    async size(prefix) {
      const f = from(prefix);
      const rows = await db.query<{ n: number }>(`SELECT COUNT(*) AS n ${f.sql}`, f.params);
      return Number(rows[0]?.n ?? 0);
    },
    async entries(prefix) {
      const f = from(prefix);
      const rows = await db.query<{ id: number; path: string; block_id: string }>(
        `SELECT b.id, b.path, b.block_id ${f.sql} ORDER BY b.id`,
        f.params,
      );
      return rows.map((r) => ({
        id: Number(r.id),
        path: r.path as DocumentPath,
        blockId: r.block_id,
      }));
    },
    async *paths(prefix) {
      const f = from(prefix);
      const rows = await db.query<{ path: string }>(`SELECT DISTINCT b.path ${f.sql}`, f.params);
      for (const r of rows) yield r.path as DocumentPath;
    },
    async *refs(prefix) {
      for (const e of await this.entries(prefix)) yield { path: e.path, blockId: e.blockId };
    },
  };
}
