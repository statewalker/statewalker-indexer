import type { Db } from "@statewalker/db-api";
import type { BlockReference, DocumentPath, PathSelector } from "@statewalker/indexer-api";
import { compositeKey } from "@statewalker/indexer-core";
import { pathPrefixSql } from "./path-sql.js";

/**
 * The Index-wide `{path, blockId} ↔ integer id` table shared by every sub-index.
 * Every method takes the `Db` to run on, so it works on `tx` inside `inTransaction`.
 * Rows are never deleted before `deleteIndex`: an id stays stable for its block.
 */
export interface BlockIds {
  readonly table: string;
  /** Ids for `refs`, in order; missing rows are created. */
  ensure(db: Db, refs: readonly BlockReference[]): Promise<number[]>;
  /** Ids of every known block matched by any selector (path prefix, or exact block). */
  select(db: Db, selectors: readonly PathSelector[]): Promise<number[]>;
  /** References of `ids`; unknown ids are absent. */
  refs(db: Db, ids: readonly number[]): Promise<Map<number, BlockReference>>;
}

export async function openBlockIds(db: Db, table: string): Promise<BlockIds> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY, path TEXT NOT NULL, block_id TEXT NOT NULL, UNIQUE (path, block_id))`,
  );
  return {
    table,
    async ensure(tx, refs) {
      if (refs.length === 0) return [];
      const json = JSON.stringify(refs.map((r) => [r.path, r.blockId]));
      // `WHERE true` disambiguates `SELECT … ON CONFLICT` for the SQLite parser.
      await tx.query(
        `INSERT INTO ${table} (path, block_id) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?) WHERE true ON CONFLICT (path, block_id) DO NOTHING`,
        [json],
      );
      const rows = await tx.query<{ id: number; path: string; block_id: string }>(
        `SELECT b.id, b.path, b.block_id FROM ${table} b JOIN json_each(?) j ON b.path = json_extract(j.value, '$[0]') AND b.block_id = json_extract(j.value, '$[1]')`,
        [json],
      );
      const byKey = new Map(
        rows.map((r) => [compositeKey(r.path as DocumentPath, r.block_id), Number(r.id)]),
      );
      return refs.map((r) => {
        const id = byKey.get(compositeKey(r.path, r.blockId));
        if (id === undefined) throw new Error(`block id missing for ${r.path}#${r.blockId}`);
        return id;
      });
    },
    async select(tx, selectors) {
      const ids = new Set<number>();
      for (const sel of selectors) {
        const where =
          sel.blockId !== undefined
            ? { sql: "b.path = ? AND b.block_id = ?", params: [sel.path, sel.blockId] }
            : pathPrefixSql("b.path", [sel.path]);
        const rows = await tx.query<{ id: number }>(
          `SELECT b.id FROM ${table} b WHERE ${where.sql}`,
          where.params,
        );
        for (const r of rows) ids.add(Number(r.id));
      }
      return [...ids];
    },
    async refs(tx, ids) {
      const out = new Map<number, BlockReference>();
      if (ids.length === 0) return out;
      const rows = await tx.query<{ id: number; path: string; block_id: string }>(
        `SELECT id, path, block_id FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`,
        [JSON.stringify(ids)],
      );
      for (const r of rows)
        out.set(Number(r.id), { path: r.path as DocumentPath, blockId: r.block_id });
      return out;
    },
  };
}
