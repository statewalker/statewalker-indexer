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

function compositeKey(path: DocumentPath, blockId: string): string {
  return `${path}\0${blockId}`;
}

function matchesPrefix(path: DocumentPath, prefix: DocumentPath): boolean {
  return path.startsWith(prefix);
}

export class MemVectorIndex implements EmbeddingIndex {
  private readonly info: EmbeddingIndexInfo;
  private readonly entries = new Map<string, StoredEntry>();
  private closed = false;

  constructor(info: EmbeddingIndexInfo) {
    this.info = info;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("EmbeddingIndex is closed");
    }
  }

  private validateDimensionality(embedding: Float32Array): void {
    if (embedding.length !== this.info.dimensionality) {
      throw new Error(
        `Expected dimensionality ${this.info.dimensionality}, got ${embedding.length}`,
      );
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
      this.validateDimensionality(queryEmb);
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
    for (const block of blocks) {
      this.validateDimensionality(block.embedding);
      const key = compositeKey(block.path, block.blockId);
      this.entries.set(key, {
        path: block.path,
        blockId: block.blockId,
        embedding: new Float32Array(block.embedding),
        metadata: block.metadata,
      });
    }
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
    for await (const sel of pathSelectors as AsyncIterable<PathSelector>) {
      if (sel.blockId !== undefined) {
        this.entries.delete(compositeKey(sel.path, sel.blockId));
      } else {
        for (const [key, entry] of this.entries) {
          if (matchesPrefix(entry.path, sel.path)) {
            this.entries.delete(key);
          }
        }
      }
    }
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
    this.closed = true;
  }

  /** Serialize embeddings to Arrow IPC format */
  serializeToArrow(): Uint8Array {
    const dim = this.info.dimensionality;
    const paths: string[] = [];
    const blockIds: string[] = [];
    const embeddingArrays: number[][] = [];
    for (const entry of this.entries.values()) {
      paths.push(entry.path);
      blockIds.push(entry.blockId);
      embeddingArrays.push(Array.from(entry.embedding));
    }
    const table = tableFromArrays(
      { path: paths, blockId: blockIds, embedding: embeddingArrays },
      {
        types: {
          path: utf8(),
          blockId: utf8(),
          embedding: fixedSizeList(float32(), dim),
        },
      },
    );
    return tableToIPC(table, { format: "stream" }) as Uint8Array;
  }

  /** Deserialize embeddings from Arrow IPC format */
  static deserializeFromArrow(info: EmbeddingIndexInfo, data: Uint8Array): MemVectorIndex {
    const table = tableFromIPC(data);
    const vec = new MemVectorIndex(info);
    const pathCol = table.getChild("path");
    const blockIdCol = table.getChild("blockId");
    const embCol = table.getChild("embedding");
    for (let i = 0; i < table.numRows; i++) {
      const path = pathCol.at(i) as string as DocumentPath;
      const blockId = blockIdCol.at(i) as string;
      const embedding = new Float32Array(embCol.at(i) as ArrayLike<number>);
      const key = compositeKey(path, blockId);
      vec.entries.set(key, { path, blockId, embedding });
    }
    return vec;
  }
}
