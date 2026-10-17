import type { Db } from "@statewalker/db-api";
import type { BlockReference, Index, ScoredHit, SearchIndex } from "@statewalker/indexer-api";
import { collect, defined } from "@statewalker/indexer-tests";
import { describe, expect, it, vi } from "vitest";
import {
  createSqliteIndexer,
  newEnumeration,
  pathPrefixSql,
  type SqliteModalityProvider,
} from "../src/index.js";
import { flavours } from "./support/dbs.js";

type Tag = BlockReference & { tag: string };

/** Minimal provider: one `{prefix}tags(id PRIMARY KEY, tag)` table; search = exact tag. */
function tagProvider(
  type = "tag",
): SqliteModalityProvider<{ label: string }, SearchIndex<Tag, string, ScoredHit>> {
  return {
    type,
    async open({ db, prefix, blockIds }) {
      const table = `${prefix}tags`;
      await db.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY, tag TEXT NOT NULL)`,
      );
      const list = newEnumeration(db, blockIds, `SELECT id FROM ${table}`);
      const index: SearchIndex<Tag, string, ScoredHit> = {
        async *search(tag: string) {
          const rows = await db.query<{ id: number }>(`SELECT id FROM ${table} WHERE tag = ?`, [
            tag,
          ]);
          const refs = await blockIds.refs(
            db,
            rows.map((r) => Number(r.id)),
          );
          for (const ref of refs.values()) yield { ...ref, score: 1 };
        },
        async addDocument(blocks: Tag[]) {
          const ids = await blockIds.ensure(db, blocks);
          for (const [i, id] of ids.entries()) {
            await db.query(`INSERT OR REPLACE INTO ${table} (id, tag) VALUES (?, ?)`, [
              id,
              blocks[i]?.tag,
            ]);
          }
        },
        async addDocuments(batches) {
          for await (const b of batches) await index.addDocument(b);
        },
        async deleteDocuments(selectors) {
          const sels = [];
          for await (const s of selectors) sels.push(s);
          const ids = await blockIds.select(db, sels);
          await db.query(`DELETE FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`, [
            JSON.stringify(ids),
          ]);
        },
        getSize: (p) => list.size(p),
        getDocumentPaths: (p) => list.paths(p),
        getDocumentBlocksRefs: (p) => list.refs(p),
        async *getDocumentsBlocks() {},
        async close() {},
        async flush() {},
        async deleteIndex() {
          await db.exec(`DROP TABLE IF EXISTS ${table}`);
        },
      };
      return index;
    },
    async drop({ db, prefix }) {
      await db.exec(`DROP TABLE IF EXISTS ${prefix}tags`);
    },
  };
}

async function tables(db: Db): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    // `_cf_*` are the Durable Object runtime's own tables.
    "SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 4) <> '_cf_' ORDER BY name",
  );
  return rows.map((r) => r.name);
}

for (const flavour of flavours) {
  describe(`indexer-sqlite kernel — ${flavour.name}`, () => {
    it("creates the manifest, a blocks table per Index and one prefix per sub-index", async () => {
      const db = await flavour.open();
      const indexer = await createSqliteIndexer({ db, providers: [tagProvider()] });
      await indexer.createIndex({ name: "docs", subIndexes: { a: { type: "tag", label: "x" } } });
      expect(await tables(db)).toEqual(
        expect.arrayContaining(["__indexer_manifest", "idx_docs__blocks", "idx_docs__a_tags"]),
      );
    });

    it("a reopened indexer adopts the saved index and its data", async () => {
      const db = await flavour.open();
      const first = await createSqliteIndexer({ db, providers: [tagProvider()] });
      const idx = await first.createIndex({
        name: "docs",
        subIndexes: { a: { type: "tag", label: "x" } },
      });
      await (defined(idx.getBinding("a")).index as SearchIndex<Tag, string, ScoredHit>).addDocument(
        [{ path: "/d/1", blockId: "b1", tag: "red" }],
      );
      await first.close();

      const second = await createSqliteIndexer({ db, providers: [tagProvider()] });
      const reopened = (await second.getIndex("docs")) as Index;
      const hits = await collect(reopened.search({ topK: 5, subQueries: { a: "red" } }));
      expect(hits.map((h) => [h.path, h.blockId])).toEqual([["/d/1", "b1"]]);
    });

    it("a saved type without a provider throws by default and is skipped under 'warn'", async () => {
      const db = await flavour.open();
      const first = await createSqliteIndexer({
        db,
        providers: [tagProvider(), tagProvider("other")],
      });
      await first.createIndex({
        name: "docs",
        subIndexes: { a: { type: "tag", label: "x" }, b: { type: "other", label: "y" } },
      });
      await first.close();

      const strict = await createSqliteIndexer({ db, providers: [tagProvider()] });
      await expect(strict.getIndex("docs")).rejects.toThrow(
        'sub-index "b" requires modality "other"',
      );
      const lenient = await createSqliteIndexer({ db, providers: [tagProvider()] });
      const warn = vi
        .spyOn(
          (globalThis as unknown as { console: { warn(...args: unknown[]): void } }).console,
          "warn",
        )
        .mockImplementation(() => {});
      const idx = await lenient.getIndex("docs", { onMissingProvider: "warn" });
      expect(warn).toHaveBeenCalledWith('Sub-index "b" (type "other") has no provider; skipping.');
      warn.mockRestore();
      expect(idx?.getBinding("a")).toBeDefined();
      expect(idx?.getBinding("b")).toBeUndefined();
    });

    it("deleteIndex drops every table of the index and its manifest row", async () => {
      const db = await flavour.open();
      const indexer = await createSqliteIndexer({ db, providers: [tagProvider()] });
      await indexer.createIndex({ name: "docs", subIndexes: { a: { type: "tag", label: "x" } } });
      await indexer.deleteIndex("docs");
      expect(await tables(db)).toEqual(["__indexer_manifest"]);
      expect(await indexer.hasIndex("docs")).toBe(false);
    });

    it("reinit drops the old sub-index tables before reopening with the new config", async () => {
      const db = await flavour.open();
      const first = await createSqliteIndexer({ db, providers: [tagProvider()] });
      const idx = await first.createIndex({
        name: "docs",
        subIndexes: { a: { type: "tag", label: "x" } },
      });
      await (defined(idx.getBinding("a")).index as SearchIndex<Tag, string, ScoredHit>).addDocument(
        [{ path: "/d/1", blockId: "b1", tag: "red" }],
      );
      await first.close();
      const second = await createSqliteIndexer({ db, providers: [tagProvider()] });
      const re = await second.getIndex("docs", { subIndexes: { a: { type: "tag", label: "z" } } });
      expect(await re?.getBinding("a")?.index.getSize()).toBe(0);
    });

    it("deleteIndex on a live index also drops the tables of skipped sub-indexes", async () => {
      const db = await flavour.open();
      const subIndexes = { a: { type: "tag", label: "x" }, b: { type: "tag", label: "y" } };
      const first = await createSqliteIndexer({ db, providers: [tagProvider()] });
      const idx = await first.createIndex({ name: "docs", subIndexes });
      await (defined(idx.getBinding("b")).index as SearchIndex<Tag, string, ScoredHit>).addDocument(
        [{ path: "/d/1", blockId: "b1", tag: "red" }],
      );
      await first.close();

      const second = await createSqliteIndexer({ db, providers: [tagProvider()] });
      const live = await second.getIndex("docs", { subIndexes: { b: { skip: true } } });
      expect(live?.getBinding("b")).toBeUndefined();
      await second.deleteIndex("docs");
      expect(await tables(db)).toEqual(["__indexer_manifest"]);

      const recreated = await second.createIndex({ name: "docs", subIndexes });
      expect(await defined(recreated.getBinding("b")).index.getSize()).toBe(0);
      const hits = await collect(recreated.search({ topK: 5, subQueries: { b: "red" } }));
      expect(hits).toEqual([]);
    });

    it("reinit to an unregistered type keeps the old data", async () => {
      const db = await flavour.open();
      const first = await createSqliteIndexer({ db, providers: [tagProvider()] });
      const idx = await first.createIndex({
        name: "docs",
        subIndexes: { a: { type: "tag", label: "x" } },
      });
      await (defined(idx.getBinding("a")).index as SearchIndex<Tag, string, ScoredHit>).addDocument(
        [{ path: "/d/1", blockId: "b1", tag: "red" }],
      );
      await first.close();
      const second = await createSqliteIndexer({ db, providers: [tagProvider()] });
      await expect(
        second.getIndex("docs", { subIndexes: { a: { type: "nope" } } }),
      ).rejects.toThrow('requires modality "nope"');
      const again = await second.getIndex("docs");
      expect(await again?.getBinding("a")?.index.getSize()).toBe(1);
    });

    it("index names differing only in case are independent", async () => {
      const db = await flavour.open();
      const indexer = await createSqliteIndexer({ db, providers: [tagProvider()] });
      const upper = await indexer.createIndex({
        name: "Docs",
        subIndexes: { a: { type: "tag", label: "x" } },
      });
      await (
        defined(upper.getBinding("a")).index as SearchIndex<Tag, string, ScoredHit>
      ).addDocument([{ path: "/secret", blockId: "b1", tag: "red" }]);
      const lower = await indexer.createIndex({
        name: "docs",
        subIndexes: { a: { type: "tag", label: "x" } },
      });
      expect(await defined(lower.getBinding("a")).index.getSize()).toBe(0);
      expect(await collect(lower.search({ topK: 5, subQueries: { a: "red" } }))).toEqual([]);
      await indexer.deleteIndex("docs");
      expect(await defined(upper.getBinding("a")).index.getSize()).toBe(1);
      expect(await collect(upper.search({ topK: 5, subQueries: { a: "red" } }))).toHaveLength(1);
    });

    it("sub-index names differing only in case are independent", async () => {
      const db = await flavour.open();
      const indexer = await createSqliteIndexer({ db, providers: [tagProvider()] });
      const idx = await indexer.createIndex({
        name: "docs",
        subIndexes: { Body: { type: "tag", label: "x" }, body: { type: "tag", label: "y" } },
      });
      await (
        defined(idx.getBinding("Body")).index as SearchIndex<Tag, string, ScoredHit>
      ).addDocument([{ path: "/d/1", blockId: "b1", tag: "red" }]);
      expect(await defined(idx.getBinding("body")).index.getSize()).toBe(0);
      await defined(idx.getBinding("body")).index.deleteIndex();
      expect(await defined(idx.getBinding("Body")).index.getSize()).toBe(1);
    });

    it("concurrent first getIndex calls open the index once", async () => {
      const db = await flavour.open();
      const first = await createSqliteIndexer({ db, providers: [tagProvider()] });
      await first.createIndex({ name: "docs", subIndexes: { a: { type: "tag", label: "x" } } });
      await first.close();

      const second = await createSqliteIndexer({ db, providers: [tagProvider()] });
      const [x, y] = await Promise.all([second.getIndex("docs"), second.getIndex("docs")]);
      expect(x).toBe(y);
    });
  });
}

describe("pathPrefixSql", () => {
  it("matches path-component boundaries, case-sensitively", async () => {
    const db = await defined(flavours[0]).open();
    await db.exec("CREATE TABLE p (path TEXT)");
    for (const path of ["/docs/a", "/Docs/b", "/foo", "/foo/x", "/foobar"]) {
      await db.query("INSERT INTO p VALUES (?)", [path]);
    }
    const run = async (prefixes: string[]) => {
      const c = pathPrefixSql("t.path", prefixes);
      const rows = await db.query<{ path: string }>(
        `SELECT t.path AS path FROM p t WHERE ${c.sql} ORDER BY t.path`,
        c.params,
      );
      return rows.map((r) => r.path);
    };
    expect(await run(["/docs"])).toEqual(["/docs/a"]);
    expect(await run(["/foo"])).toEqual(["/foo", "/foo/x"]);
    expect(await run(["/foo/"])).toEqual(["/foo/x"]);
    expect(await run([])).toEqual(["/Docs/b", "/docs/a", "/foo", "/foo/x", "/foobar"]);
  });
});
