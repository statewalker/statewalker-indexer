import { inTransaction } from "@statewalker/db-sqlite";
import type { DocumentPath, Metadata, PathSelector } from "@statewalker/indexer-api";
import { toAsyncIterable } from "@statewalker/indexer-core";
import {
  FULL_TEXT_TYPE,
  type FullTextBlock,
  type FullTextConfig,
  type FullTextIndex,
  type FulltextQuery,
  type FulltextResult,
} from "@statewalker/indexer-fulltext";
import { newEnumeration } from "./enumeration.js";
import { pathPrefixSql } from "./path-sql.js";
import type { SqliteModalityProvider } from "./types.js";

/** `en` gets the Porter stemmer; any other language (known or not) gets plain `unicode61`. */
function tokenizerFor(language: string): string {
  return language === "en"
    ? "porter unicode61 remove_diacritics 2"
    : "unicode61 remove_diacritics 2";
}

/**
 * One FTS5 MATCH expression per query string: every word with a letter or a
 * digit, double-quoted (so `AND`, `*`, `NEAR(` are plain words), OR-joined so
 * partial matches are returned. `null` when nothing is searchable.
 */
export function toMatchExpression(query: string): string | null {
  const words = query
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .map((w) => `"${w.replaceAll('"', '""')}"`);
  return words.length > 0 ? words.join(" OR ") : null;
}

export function newSqliteFullTextProvider(): SqliteModalityProvider<FullTextConfig, FullTextIndex> {
  return {
    type: FULL_TEXT_TYPE,

    async drop({ db, prefix }) {
      await db.exec(`DROP TABLE IF EXISTS ${prefix}fts`);
    },

    async open({ db, prefix, blockIds }, config) {
      const table = `${prefix}fts`;
      const blocks = blockIds.table;
      await db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING fts5(content, metadata UNINDEXED, tokenize='${tokenizerFor(config.language)}')`,
      );
      const list = newEnumeration(db, blockIds, `SELECT rowid AS id FROM ${table}`);
      let closed = false;
      const ensureOpen = () => {
        if (closed) throw new Error("FullTextIndex is closed");
      };
      const collectSelectors = async (selectors: PathSelector[] | AsyncIterable<PathSelector>) => {
        const all: PathSelector[] = [];
        for await (const s of toAsyncIterable(selectors)) all.push(s);
        return all;
      };

      const index: FullTextIndex = {
        async getIndexInfo() {
          return { language: config.language, metadata: config.metadata };
        },

        async *search(params: FulltextQuery): AsyncGenerator<FulltextResult> {
          ensureOpen();
          const topK = params.topK ?? 100;
          const scope = pathPrefixSql("b.path", params.paths ?? []);
          // Several queries accumulate (SUM): a block matching more of them ranks higher.
          const merged = new Map<number, { score: number; best: number; snippet: string }>();
          for (const query of params.queries ?? []) {
            const match = toMatchExpression(query);
            if (!match) continue;
            const rows = await db.query<{ id: number; score: number; snippet: string }>(
              `SELECT ${table}.rowid AS id, -bm25(${table}) AS score, snippet(${table}, 0, '', '', '…', 16) AS snippet FROM ${table} JOIN ${blocks} b ON b.id = ${table}.rowid WHERE ${table} MATCH ? AND ${scope.sql} ORDER BY score DESC LIMIT ?`,
              [match, ...scope.params, topK],
            );
            for (const r of rows) {
              const id = Number(r.id);
              const prev = merged.get(id);
              if (!prev) merged.set(id, { score: r.score, best: r.score, snippet: r.snippet });
              else {
                prev.score += r.score;
                if (r.score > prev.best) Object.assign(prev, { best: r.score, snippet: r.snippet });
              }
            }
          }
          const top = [...merged.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, topK);
          const refs = await blockIds.refs(
            db,
            top.map(([id]) => id),
          );
          for (const [id, hit] of top) {
            const ref = refs.get(id);
            if (ref) yield { ...ref, score: hit.score, snippet: hit.snippet };
          }
        },

        async addDocument(blocksIn: FullTextBlock[]) {
          ensureOpen();
          if (blocksIn.length === 0) return;
          await inTransaction(db, async (tx) => {
            const ids = await blockIds.ensure(tx, blocksIn);
            for (const [i, id] of ids.entries()) {
              const block = blocksIn[i] as FullTextBlock;
              // FTS5 has no UPSERT: delete then insert, atomically inside the transaction.
              await tx.query(`DELETE FROM ${table} WHERE rowid = ?`, [id]);
              await tx.query(`INSERT INTO ${table} (rowid, content, metadata) VALUES (?, ?, ?)`, [
                id,
                block.content,
                block.metadata ? JSON.stringify(block.metadata) : null,
              ]);
            }
          });
        },

        async addDocuments(batches) {
          for await (const batch of batches) await this.addDocument(batch);
        },

        async deleteDocuments(selectors) {
          ensureOpen();
          const sels = await collectSelectors(selectors);
          await inTransaction(db, async (tx) => {
            const ids = await blockIds.select(tx, sels);
            await tx.query(`DELETE FROM ${table} WHERE rowid IN (SELECT value FROM json_each(?))`, [
              JSON.stringify(ids),
            ]);
          });
        },

        getSize: (p?: DocumentPath) => list.size(p),
        getDocumentPaths: (p?: DocumentPath) => list.paths(p),
        getDocumentBlocksRefs: (p?: DocumentPath) => list.refs(p),

        async *getDocumentsBlocks(p?: DocumentPath): AsyncGenerator<FullTextBlock> {
          const scope = pathPrefixSql("b.path", p ? [p] : []);
          const rows = await db.query<{
            path: string;
            block_id: string;
            content: string;
            metadata: string | null;
          }>(
            `SELECT b.path, b.block_id, f.content, f.metadata FROM ${table} f JOIN ${blocks} b ON b.id = f.rowid WHERE ${scope.sql} ORDER BY b.id`,
            scope.params,
          );
          for (const r of rows) {
            yield {
              path: r.path as DocumentPath,
              blockId: r.block_id,
              content: r.content,
              ...(r.metadata ? { metadata: JSON.parse(r.metadata) as Metadata } : {}),
            };
          }
        },

        async close() {
          closed = true;
        },
        async flush() {},
        async deleteIndex() {
          closed = true;
          await db.exec(`DROP TABLE IF EXISTS ${table}`);
        },
      };
      return index;
    },
  };
}
