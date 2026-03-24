import type {
  BlockId,
  SearchResult,
  VectorIndex,
  VectorIndexInfo,
} from "@repo/indexer-api";
import {
  fixedSizeList,
  float32,
  tableFromArrays,
  tableFromIPC,
  tableToIPC,
  utf8,
} from "@uwdata/flechette";
import { bruteForceSearch } from "./vector-search.js";

export class MemVectorIndex implements VectorIndex {
  private readonly info: VectorIndexInfo;
  private readonly embeddings: Map<BlockId, Float32Array> = new Map();
  private closed = false;

  constructor(info: VectorIndexInfo) {
    this.info = info;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("VectorIndex is closed");
    }
  }

  private validateDimensionality(embedding: Float32Array): void {
    if (embedding.length !== this.info.dimensionality) {
      throw new Error(
        `Expected dimensionality ${this.info.dimensionality}, got ${embedding.length}`,
      );
    }
  }

  async getIndexInfo(): Promise<VectorIndexInfo> {
    this.ensureOpen();
    return { ...this.info };
  }

  async deleteIndex(): Promise<void> {
    this.ensureOpen();
    this.closed = true;
    this.embeddings.clear();
  }

  async search(params: {
    topK: number;
    embedding: Float32Array;
  }): Promise<SearchResult[]> {
    this.ensureOpen();
    this.validateDimensionality(params.embedding);
    return bruteForceSearch(params.embedding, this.embeddings, params.topK);
  }

  async addDocument(params: {
    blockId: BlockId;
    embedding: Float32Array;
  }): Promise<void> {
    this.ensureOpen();
    this.validateDimensionality(params.embedding);
    this.embeddings.set(params.blockId, new Float32Array(params.embedding));
  }

  async addDocuments(
    docs:
      | Iterable<{ blockId: BlockId; embedding: Float32Array }>
      | AsyncIterable<{ blockId: BlockId; embedding: Float32Array }>,
  ): Promise<void> {
    this.ensureOpen();
    for await (const doc of docs as AsyncIterable<{
      blockId: BlockId;
      embedding: Float32Array;
    }>) {
      await this.addDocument(doc);
    }
  }

  async deleteDocument(blockId: BlockId): Promise<void> {
    this.ensureOpen();
    this.embeddings.delete(blockId);
  }

  async deleteDocuments(
    blockIds: Iterable<BlockId> | AsyncIterable<BlockId>,
  ): Promise<void> {
    this.ensureOpen();
    for await (const blockId of blockIds as AsyncIterable<BlockId>) {
      await this.deleteDocument(blockId);
    }
  }

  async hasDocument(blockId: BlockId): Promise<boolean> {
    this.ensureOpen();
    return this.embeddings.has(blockId);
  }

  async getSize(): Promise<number> {
    this.ensureOpen();
    return this.embeddings.size;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Get the set of block IDs stored in this index */
  getBlockIds(): Set<string> {
    return new Set(this.embeddings.keys());
  }

  /** Serialize embeddings to Arrow IPC format */
  serializeToArrow(): Uint8Array {
    const dim = this.info.dimensionality;
    const blockIds = [...this.embeddings.keys()];
    const embeddingArrays: number[][] = [];
    for (const emb of this.embeddings.values()) {
      embeddingArrays.push(Array.from(emb));
    }
    const table = tableFromArrays(
      { blockId: blockIds, embedding: embeddingArrays },
      { types: { blockId: utf8(), embedding: fixedSizeList(float32(), dim) } },
    );
    return tableToIPC(table, { format: "stream" }) as Uint8Array;
  }

  /** Deserialize embeddings from Arrow IPC format */
  static deserializeFromArrow(
    info: VectorIndexInfo,
    data: Uint8Array,
  ): MemVectorIndex {
    const table = tableFromIPC(data);
    const vec = new MemVectorIndex(info);
    const blockIdCol = table.getChild("blockId");
    const embCol = table.getChild("embedding");
    for (let i = 0; i < table.numRows; i++) {
      const blockId = blockIdCol.at(i) as string;
      const emb = new Float32Array(embCol.at(i) as ArrayLike<number>);
      vec.embeddings.set(blockId, emb);
    }
    return vec;
  }
}
