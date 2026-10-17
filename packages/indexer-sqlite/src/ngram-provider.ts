import { NgramStore } from "@statewalker/db-sqlite-index/ngram";
import type { DocumentPath, PathSelector } from "@statewalker/indexer-api";
import { toAsyncIterable } from "@statewalker/indexer-core";
import {
  NGRAM_TYPE,
  type NgramBlock,
  type NgramConfig,
  type NgramIndex,
  type NgramMatch,
  type NgramQuery,
  type NgramResult,
  type NgramSearchSummary,
} from "@statewalker/indexer-ngram";
import { newEnumeration } from "./enumeration.js";
import type { SqliteModalityProvider } from "./types.js";

/**
 * Blocks per `NgramStore.upsert`: each upsert is one transaction, and a
 * Durable Object retries a write that runs past its ~15 s deadline.
 */
const UPSERT_BATCH = 500;

/** 1-based line of each offset, from the positions of `\n` in `text`. */
function withLines(text: string, matches: { start: number; end: number }[]): NgramMatch[] {
  const breaks: number[] = [];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) breaks.push(i);
  let line = 1;
  let b = 0;
  return [...matches]
    .sort((x, y) => x.start - y.start)
    .map(({ start, end }) => {
      while (b < breaks.length && (breaks[b] as number) < start) {
        b++;
        line++;
      }
      return { start, end, line };
    });
}

/**
 * Wraps the id-based `NgramStore` (own transactions; never call it inside
 * `inTransaction`). Tables live under `{prefix}ng_`. Size and enumeration join
 * the store's `idTable`. Score = match count; ties keep the store's
 * ascending-id order.
 */
export function newSqliteNgramProvider(): SqliteModalityProvider<NgramConfig, NgramIndex> {
  return {
    type: NGRAM_TYPE,

    async drop({ db, prefix }) {
      await new NgramStore({ db, prefix: `${prefix}ng_` }).drop(); // drops either store's tables
    },

    async open({ db, prefix, blockIds }, config) {
      const storeKind = config.store ?? "fts5";
      const store = new NgramStore({ db, prefix: `${prefix}ng_`, store: storeKind });
      await store.init();
      const list = newEnumeration(db, blockIds, `SELECT id FROM ${store.idTable}`);
      let closed = false;
      const ensureOpen = () => {
        if (closed) throw new Error("NgramIndex is closed");
      };

      const index: NgramIndex = {
        async getIndexInfo() {
          return { store: storeKind, ...(config.metadata ? { metadata: config.metadata } : {}) };
        },

        async *search(params: NgramQuery): AsyncGenerator<NgramResult, NgramSearchSummary> {
          ensureOpen();
          const allowed = params.paths?.length
            ? new Set(
                await blockIds.select(
                  db,
                  params.paths.map((path) => ({ path })),
                ),
              )
            : undefined;
          const result = await store.search(params.pattern, {
            regex: params.regex ?? false,
            caseSensitive: params.caseSensitive ?? true,
            limit: params.topK ?? 100,
            ...(allowed ? { filter: (id: number) => allowed.has(id) } : {}),
          });
          const hits = result.hits.filter((h) => h.matches.length > 0);
          const ids = hits.map((h) => h.id);
          const [texts, refs] = await Promise.all([store.getTexts(ids), blockIds.refs(db, ids)]);
          // Array sort is stable: equal counts keep the store's ascending-id order.
          const ranked = hits.sort((x, y) => y.matches.length - x.matches.length);
          for (const h of ranked) {
            const ref = refs.get(h.id);
            if (!ref) continue;
            const count = h.matches.length;
            yield {
              ...ref,
              score: count,
              count,
              matches: withLines(texts.get(h.id) ?? "", h.matches),
            };
          }
          return { truncated: result.truncated };
        },

        async addDocument(blocks: NgramBlock[]) {
          ensureOpen();
          for (let i = 0; i < blocks.length; i += UPSERT_BATCH) {
            const batch = blocks.slice(i, i + UPSERT_BATCH);
            const ids = await blockIds.ensure(db, batch);
            await store.upsert(
              ids.map((id, j) => ({ id, text: (batch[j] as NgramBlock).content })),
            );
          }
        },

        async addDocuments(batches) {
          for await (const batch of batches) await this.addDocument(batch);
        },

        async deleteDocuments(selectors) {
          ensureOpen();
          const sels: PathSelector[] = [];
          for await (const s of toAsyncIterable(selectors)) sels.push(s);
          const ids = await blockIds.select(db, sels);
          if (ids.length === 0) return;
          await store.delete(ids);
        },

        getSize: (p?: DocumentPath) => list.size(p),
        getDocumentPaths: (p?: DocumentPath) => list.paths(p),
        getDocumentBlocksRefs: (p?: DocumentPath) => list.refs(p),

        async *getDocumentsBlocks(p?: DocumentPath): AsyncGenerator<NgramBlock> {
          const entries = await list.entries(p);
          const texts = await store.getTexts(entries.map((e) => e.id));
          for (const e of entries) {
            const content = texts.get(e.id);
            if (content !== undefined) yield { path: e.path, blockId: e.blockId, content };
          }
        },

        async close() {
          closed = true;
        },
        async flush() {},
        async deleteIndex() {
          closed = true;
          await store.drop();
        },
      };
      return index;
    },
  };
}
