import type {
  BlockReference,
  DocumentPath,
  EmbeddingBlock,
  EmbeddingIndex,
  EmbeddingIndexInfo,
  EmbeddingSearchParams,
  EmbeddingSearchResult,
  Metadata,
  PathSelector,
} from "@statewalker/indexer-api";
import {
  compositeKey,
  matchesPrefix,
  toAsyncIterable,
  validateDimensionality,
} from "@statewalker/indexer-core";
import {
  fixedSizeList,
  float32,
  tableFromArrays,
  tableFromIPC,
  tableToIPC,
  utf8,
} from "@uwdata/flechette";
import { bruteForceSearch } from "./vector-search.js";

interface StoredEntry {
  path: DocumentPath;
  blockId: string;
  embedding: Float32Array;
  metadata?: Metadata;
}

export class MemVectorIndex implements EmbeddingIndex {
  private readonly info: EmbeddingIndexInfo;
  private readonly entries = new Map<string, StoredEntry>();
  private closed = false;
  /**
   * Dirty bit. `true` whenever `entries` has been mutated since the last
   * `serializeToArrow()`. The serializer caches the last produced
   * `Uint8Array` and returns it directly when `!dirty`, so a no-op re-sync
   * skips the expensive Arrow IPC encoding for an unchanged index.
   * Starts `true` so the first serialize after construction always runs.
   */
  private dirty = true;
  private cachedSerialized?: Uint8Array;

  constructor(info: EmbeddingIndexInfo) {
    this.info = info;
  }

  /**
   * `true` when the in-memory state has changed since the last serialize.
   * Callers (e.g. the persistence layer) may use it to skip serialization
   * and writes when the index has not been touched.
   */
  isDirty(): boolean {
    return this.dirty;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("EmbeddingIndex is closed");
    }
  }

  private *filteredEntries(pathPrefixes?: DocumentPath[]): Iterable<StoredEntry> {
    if (!pathPrefixes || pathPrefixes.length === 0) {
      yield* this.entries.values();
      return;
    }
    for (const entry of this.entries.values()) {
      if (pathPrefixes.some((p) => matchesPrefix(entry.path, p))) {
        yield entry;
      }
    }
  }

  async getIndexInfo(): Promise<EmbeddingIndexInfo> {
    this.ensureOpen();
    return { ...this.info };
  }

  async *search(params: EmbeddingSearchParams): AsyncGenerator<EmbeddingSearchResult> {
    this.ensureOpen();
    const { embeddings, topK, paths } = params;

    if (!embeddings || embeddings.length === 0) return;

    // Multi-embedding: search for each, merge by best score
    const bestScores = new Map<string, EmbeddingSearchResult>();

    for (const queryEmb of embeddings) {
      validateDimensionality(this.info, queryEmb);
      const filtered = [...this.filteredEntries(paths)];
      const results = bruteForceSearch(queryEmb, filtered, topK);
      for (const r of results) {
        const key = compositeKey(r.path, r.blockId);
        const existing = bestScores.get(key);
        if (!existing || r.score > existing.score) {
          bestScores.set(key, r);
        }
      }
    }

    const sorted = [...bestScores.values()].sort((a, b) => b.score - a.score);
    for (const r of sorted.slice(0, topK)) {
      yield r;
    }
  }

  async addDocument(blocks: EmbeddingBlock[]): Promise<void> {
    this.ensureOpen();
    if (blocks.length === 0) return;
    for (const block of blocks) {
      validateDimensionality(this.info, block.embedding);
      const key = compositeKey(block.path, block.blockId);
      this.entries.set(key, {
        path: block.path,
        blockId: block.blockId,
        embedding: new Float32Array(block.embedding),
        metadata: block.metadata,
      });
    }
    this.dirty = true;
  }

  async addDocuments(
    blocks: Iterable<EmbeddingBlock[]> | AsyncIterable<EmbeddingBlock[]>,
  ): Promise<void> {
    this.ensureOpen();
    for await (const batch of blocks) {
      await this.addDocument(batch);
    }
  }

  async deleteDocuments(
    pathSelectors: PathSelector[] | AsyncIterable<PathSelector>,
  ): Promise<void> {
    this.ensureOpen();
    let removed = 0;
    for await (const sel of toAsyncIterable(pathSelectors)) {
      if (sel.blockId !== undefined) {
        if (this.entries.delete(compositeKey(sel.path, sel.blockId))) {
          removed += 1;
        }
      } else {
        for (const [key, entry] of this.entries) {
          if (matchesPrefix(entry.path, sel.path)) {
            this.entries.delete(key);
            removed += 1;
          }
        }
      }
    }
    if (removed > 0) this.dirty = true;
  }

  async getSize(pathPrefix?: DocumentPath): Promise<number> {
    this.ensureOpen();
    if (pathPrefix === undefined) return this.entries.size;
    let count = 0;
    for (const entry of this.entries.values()) {
      if (matchesPrefix(entry.path, pathPrefix)) count++;
    }
    return count;
  }

  async *getDocumentPaths(pathPrefix?: DocumentPath): AsyncGenerator<DocumentPath> {
    this.ensureOpen();
    const paths = new Set<DocumentPath>();
    for (const entry of this.entries.values()) {
      if (pathPrefix === undefined || matchesPrefix(entry.path, pathPrefix)) {
        paths.add(entry.path);
      }
    }
    for (const p of paths) yield p;
  }

  async *getDocumentBlocksRefs(pathPrefix?: DocumentPath): AsyncGenerator<BlockReference> {
    this.ensureOpen();
    for (const entry of this.entries.values()) {
      if (pathPrefix === undefined || matchesPrefix(entry.path, pathPrefix)) {
        yield { path: entry.path, blockId: entry.blockId };
      }
    }
  }

  async *getDocumentsBlocks(pathPrefix?: DocumentPath): AsyncGenerator<EmbeddingBlock> {
    this.ensureOpen();
    for (const entry of this.entries.values()) {
      if (pathPrefix === undefined || matchesPrefix(entry.path, pathPrefix)) {
        yield {
          path: entry.path,
          blockId: entry.blockId,
          embedding: entry.embedding,
          metadata: entry.metadata,
        };
      }
    }
  }

  async close(_options?: { force?: boolean }): Promise<void> {
    this.closed = true;
  }

  async flush(): Promise<void> {
    this.ensureOpen();
    // no-op for in-memory
  }

  async deleteIndex(): Promise<void> {
    this.ensureOpen();
    this.entries.clear();
    this.cachedSerialized = undefined;
    this.dirty = true;
    this.closed = true;
  }

  /**
   * Serialize embeddings to Arrow IPC format.
   *
   * Caches the result; while `dirty` is false (no mutations since the
   * last call) returns the same `Uint8Array` instance, skipping the
   * Arrow IPC encoding entirely. This makes no-op re-syncs cheap — the
   * persistence layer still calls into us each flush, but the heavy
   * encoding only runs when the index actually changed.
   */
  serializeToArrow(): Uint8Array {
    if (!this.dirty && this.cachedSerialized !== undefined) {
      return this.cachedSerialized;
    }
    const dim = this.info.dimensionality;
    const paths: string[] = [];
    const blockIds: string[] = [];
    const embeddingArrays: number[][] = [];
    const metadata: Array<string | null> = [];
    for (const entry of this.entries.values()) {
      paths.push(entry.path);
      blockIds.push(entry.blockId);
      embeddingArrays.push(Array.from(entry.embedding));
      metadata.push(entry.metadata === undefined ? null : JSON.stringify(entry.metadata));
    }
    const table = tableFromArrays(
      { path: paths, blockId: blockIds, embedding: embeddingArrays, metadata },
      {
        types: {
          path: utf8(),
          blockId: utf8(),
          embedding: fixedSizeList(float32(), dim),
          metadata: utf8(),
        },
      },
    );
    const bytes = tableToIPC(table, { format: "stream" }) as Uint8Array;
    this.cachedSerialized = bytes;
    this.dirty = false;
    return bytes;
  }

  /**
   * Deserialize embeddings from Arrow IPC format. The reconstructed index
   * starts clean (`dirty = false`) and primes its serialize cache with the
   * input bytes — a subsequent `serializeToArrow()` on the just-loaded
   * index returns the same bytes without re-encoding.
   */
  static deserializeFromArrow(info: EmbeddingIndexInfo, data: Uint8Array): MemVectorIndex {
    const table = tableFromIPC(data);
    const vec = new MemVectorIndex(info);
    const pathCol = table.getChild("path");
    const blockIdCol = table.getChild("blockId");
    const embCol = table.getChild("embedding");
    const metaCol = table.getChild("metadata");
    for (let i = 0; i < table.numRows; i++) {
      const path = pathCol.at(i) as string as DocumentPath;
      const blockId = blockIdCol.at(i) as string;
      const embedding = new Float32Array(embCol.at(i) as ArrayLike<number>);
      const metaRaw = metaCol?.at(i) as string | null | undefined;
      const metadata =
        metaRaw == null ? undefined : (JSON.parse(metaRaw) as StoredEntry["metadata"]);
      const key = compositeKey(path, blockId);
      vec.entries.set(key, { path, blockId, embedding, metadata });
    }
    vec.cachedSerialized = data;
    vec.dirty = false;
    return vec;
  }
}
