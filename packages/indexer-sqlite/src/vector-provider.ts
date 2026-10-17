import { dropVectorIndex, VectorIndex as VectorEngine } from "@statewalker/db-sqlite-index/vector";
import type { DocumentPath, PathSelector } from "@statewalker/indexer-api";
import { toAsyncIterable, validateDimensionality } from "@statewalker/indexer-core";
import {
  VECTOR_TYPE,
  type VectorBlock,
  type VectorConfig,
  type VectorIndex,
  type VectorQuery,
  type VectorResult,
} from "@statewalker/indexer-vector";
import { newEnumeration } from "./enumeration.js";
import type { SqliteModalityProvider } from "./types.js";

/**
 * Wraps the id-based `VectorIndex` engine. The engine owns its tables under
 * `{prefix}vec_` and its own transactions (never call it inside `inTransaction`);
 * this provider adds only the `{path, blockId}` mapping. Size and enumeration
 * join the engine's `idTable`, so they list exactly what the engine holds.
 */
export function newSqliteVectorProvider(): SqliteModalityProvider<VectorConfig, VectorIndex> {
  return {
    type: VECTOR_TYPE,

    async drop({ db, prefix }) {
      await dropVectorIndex(db, `${prefix}vec_`);
    },

    async open({ db, prefix, blockIds }, config) {
      const engine = new VectorEngine({
        db,
        prefix: `${prefix}vec_`,
        dims: config.dimensionality,
        metric: "cosine",
      });
      await engine.init();
      const list = newEnumeration(db, blockIds, `SELECT id FROM ${engine.idTable}`);
      let closed = false;
      const ensureOpen = () => {
        if (closed) throw new Error("VectorIndex is closed");
      };
      const info = {
        dimensionality: config.dimensionality,
        model: config.model,
        metadata: config.metadata,
      };

      const index: VectorIndex = {
        async getIndexInfo() {
          return { ...info };
        },

        async *search(params: VectorQuery): AsyncGenerator<VectorResult> {
          ensureOpen();
          const k = params.topK ?? 100;
          const allowed = params.paths?.length
            ? new Set(
                await blockIds.select(
                  db,
                  params.paths.map((path) => ({ path })),
                ),
              )
            : undefined;
          const filter = allowed ? (id: number) => allowed.has(id) : undefined;
          // Several embeddings merge by max score, like every other backend.
          const best = new Map<number, number>();
          for (const q of params.embeddings ?? []) {
            for (const hit of await engine.search(q, { k, ...(filter ? { filter } : {}) })) {
              const score = 1 - hit.distance;
              if (score > (best.get(hit.id) ?? Number.NEGATIVE_INFINITY)) best.set(hit.id, score);
            }
          }
          const top = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
          const refs = await blockIds.refs(
            db,
            top.map(([id]) => id),
          );
          for (const [id, score] of top) {
            const ref = refs.get(id);
            if (ref) yield { ...ref, score };
          }
        },

        async addDocument(blocks: VectorBlock[]) {
          ensureOpen();
          if (blocks.length === 0) return;
          for (const b of blocks) validateDimensionality(info, b.embedding);
          const ids = await blockIds.ensure(db, blocks);
          await engine.upsert(
            ids.map((id, i) => ({ id, vector: (blocks[i] as VectorBlock).embedding })),
          );
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
          await engine.delete(ids);
        },

        getSize: (p?: DocumentPath) => list.size(p),
        getDocumentPaths: (p?: DocumentPath) => list.paths(p),
        getDocumentBlocksRefs: (p?: DocumentPath) => list.refs(p),

        async *getDocumentsBlocks(p?: DocumentPath): AsyncGenerator<VectorBlock> {
          const entries = await list.entries(p);
          const vectors = await engine.getVectors(entries.map((e) => e.id));
          for (const e of entries) {
            const embedding = vectors.get(e.id);
            if (embedding) yield { path: e.path, blockId: e.blockId, embedding };
          }
        },

        async close() {
          closed = true;
        },
        async flush() {},
        async deleteIndex() {
          closed = true;
          await dropVectorIndex(db, `${prefix}vec_`);
        },
      };
      return index;
    },
  };
}
