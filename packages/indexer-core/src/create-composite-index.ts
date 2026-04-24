import type {
  BlockReference,
  DocumentPath,
  EmbeddingIndex,
  FullTextIndex,
  HybridSearchParams,
  HybridSearchResult,
  Index,
  IndexedBlock,
  Metadata,
  PathSelector,
} from "@statewalker/indexer-api";
import { toAsyncIterable } from "./async.js";
import { compositeKey } from "./composite-key.js";
import { mergeByRRF, mergeByWeights } from "./merge.js";

export interface CompositeIndexOptions {
  name: string;
  fts: FullTextIndex | null;
  vec: EmbeddingIndex | null;
  metadata?: Metadata;
  /** Engine-specific count implementation. Defaults to a sub-index union for in-memory backends. */
  getSize?: (pathPrefix?: DocumentPath) => Promise<number>;
  /** Engine-specific cleanup invoked by `deleteIndex()` AFTER sub-indexes are deleted. SQL backends pass a closure here to `DROP TABLE` the shared docs table. */
  onDeleteIndex?: () => Promise<void>;
}

/**
 * Engine-agnostic composite `Index` that delegates FTS and vector retrieval to sub-indexes and merges results
 * via RRF or weighted linear blend. Replaces `MemIndex` / `DuckDbIndex` / `PGLiteIndex`.
 */
export function createCompositeIndex(opts: CompositeIndexOptions): Index {
  const { name, fts, vec, metadata, onDeleteIndex } = opts;
  let closed = false;

  const ensureOpen = (): void => {
    if (closed) throw new Error(`Index "${name}" is closed`);
  };

  const defaultGetSize = async (pathPrefix?: DocumentPath): Promise<number> => {
    const seen = new Set<string>();
    if (fts) {
      for await (const ref of fts.getDocumentBlocksRefs(pathPrefix)) {
        seen.add(compositeKey(ref.path, ref.blockId));
      }
    }
    if (vec) {
      for await (const ref of vec.getDocumentBlocksRefs(pathPrefix)) {
        seen.add(compositeKey(ref.path, ref.blockId));
      }
    }
    return seen.size;
  };

  const getSize = opts.getSize ?? defaultGetSize;

  return {
    name,
    metadata,

    async *search(params: HybridSearchParams): AsyncGenerator<HybridSearchResult> {
      ensureOpen();
      const { queries, embeddings, topK, weights, paths } = params;

      const hasQueries = queries && queries.length > 0 && fts !== null;
      const hasEmbeddings = embeddings && embeddings.length > 0 && vec !== null;

      if (!hasQueries && !hasEmbeddings) return;

      const ftsResults = [];
      if (hasQueries) {
        for await (const r of fts.search({ queries, topK, paths })) {
          ftsResults.push(r);
        }
      }

      const vecResults = [];
      if (hasEmbeddings) {
        for await (const r of vec.search({ embeddings, topK, paths })) {
          vecResults.push(r);
        }
      }

      let merged: HybridSearchResult[];
      if (ftsResults.length > 0 && vecResults.length > 0) {
        merged = weights
          ? mergeByWeights(ftsResults, vecResults, weights, topK)
          : mergeByRRF(ftsResults, vecResults, topK);
      } else if (ftsResults.length > 0) {
        merged = ftsResults.map((r) => ({
          path: r.path,
          blockId: r.blockId,
          score: r.score,
          fts: r,
          embedding: null,
        }));
      } else {
        merged = vecResults.map((r) => ({
          path: r.path,
          blockId: r.blockId,
          score: r.score,
          fts: null,
          embedding: r,
        }));
      }

      for (const r of merged.slice(0, topK)) yield r;
    },

    async addDocument(blocks: IndexedBlock[]): Promise<void> {
      ensureOpen();
      const ftsBlocks = [];
      const vecBlocks = [];

      for (const block of blocks) {
        if (block.content !== undefined && fts !== null) {
          ftsBlocks.push({
            path: block.path,
            blockId: block.blockId,
            content: block.content,
            metadata: block.metadata,
          });
        }
        if (block.embedding !== undefined && vec !== null) {
          vecBlocks.push({
            path: block.path,
            blockId: block.blockId,
            embedding: block.embedding,
            metadata: block.metadata,
          });
        }
      }

      if (ftsBlocks.length > 0) await fts?.addDocument(ftsBlocks);
      if (vecBlocks.length > 0) await vec?.addDocument(vecBlocks);
    },

    async addDocuments(
      blocks: Iterable<IndexedBlock[]> | AsyncIterable<IndexedBlock[]>,
    ): Promise<void> {
      ensureOpen();
      for await (const batch of blocks) {
        await this.addDocument(batch);
      }
    },

    async deleteDocuments(
      pathSelectors: PathSelector[] | AsyncIterable<PathSelector>,
    ): Promise<void> {
      ensureOpen();
      const selectors: PathSelector[] = [];
      for await (const sel of toAsyncIterable(pathSelectors)) {
        selectors.push(sel);
      }
      if (fts !== null) await fts.deleteDocuments(selectors);
      if (vec !== null) await vec.deleteDocuments(selectors);
    },

    async getSize(pathPrefix?: DocumentPath): Promise<number> {
      ensureOpen();
      return getSize(pathPrefix);
    },

    async *getDocumentPaths(pathPrefix?: DocumentPath): AsyncGenerator<DocumentPath> {
      ensureOpen();
      const paths = new Set<string>();
      if (fts) {
        for await (const p of fts.getDocumentPaths(pathPrefix)) paths.add(p);
      }
      if (vec) {
        for await (const p of vec.getDocumentPaths(pathPrefix)) paths.add(p);
      }
      for (const p of paths) yield p as DocumentPath;
    },

    async *getDocumentBlocksRefs(pathPrefix?: DocumentPath): AsyncGenerator<BlockReference> {
      ensureOpen();
      const seen = new Set<string>();
      if (fts) {
        for await (const ref of fts.getDocumentBlocksRefs(pathPrefix)) {
          const key = compositeKey(ref.path, ref.blockId);
          if (!seen.has(key)) {
            seen.add(key);
            yield ref;
          }
        }
      }
      if (vec) {
        for await (const ref of vec.getDocumentBlocksRefs(pathPrefix)) {
          const key = compositeKey(ref.path, ref.blockId);
          if (!seen.has(key)) {
            seen.add(key);
            yield ref;
          }
        }
      }
    },

    async *getDocumentsBlocks(pathPrefix?: DocumentPath): AsyncGenerator<IndexedBlock> {
      ensureOpen();
      const blockMap = new Map<string, IndexedBlock>();

      if (fts) {
        for await (const b of fts.getDocumentsBlocks(pathPrefix)) {
          blockMap.set(compositeKey(b.path, b.blockId), {
            path: b.path,
            blockId: b.blockId,
            content: b.content,
            metadata: b.metadata,
          });
        }
      }
      if (vec) {
        for await (const b of vec.getDocumentsBlocks(pathPrefix)) {
          const key = compositeKey(b.path, b.blockId);
          const existing = blockMap.get(key);
          if (existing) {
            existing.embedding = b.embedding;
            if (!existing.metadata) existing.metadata = b.metadata;
          } else {
            blockMap.set(key, {
              path: b.path,
              blockId: b.blockId,
              embedding: b.embedding,
              metadata: b.metadata,
            });
          }
        }
      }

      for (const block of blockMap.values()) yield block;
    },

    getFullTextIndex(): FullTextIndex | null {
      return fts;
    },

    getVectorIndex(): EmbeddingIndex | null {
      return vec;
    },

    async close(_options?: { force?: boolean }): Promise<void> {
      if (closed) return;
      closed = true;
      if (fts !== null) await fts.close();
      if (vec !== null) await vec.close();
    },

    async flush(): Promise<void> {
      ensureOpen();
      if (fts !== null) await fts.flush();
      if (vec !== null) await vec.flush();
    },

    async deleteIndex(): Promise<void> {
      ensureOpen();
      if (fts !== null) await fts.deleteIndex();
      if (vec !== null) await vec.deleteIndex();
      if (onDeleteIndex) await onDeleteIndex();
      closed = true;
    },
  };
}
