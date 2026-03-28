import {
  resolveCollections as apiResolveCollections,
  type BlockId,
  type CollectionFilter,
  type CollectionId,
  DEFAULT_COLLECTION,
  isCollectionPrefix,
  type SearchResult,
  type VectorIndex,
  type VectorIndexInfo,
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
  private readonly collections: Map<CollectionId, Map<BlockId, Float32Array>> =
    new Map();
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

  private getOrCreateCollection(
    collectionId: CollectionId,
  ): Map<BlockId, Float32Array> {
    let coll = this.collections.get(collectionId);
    if (!coll) {
      coll = new Map();
      this.collections.set(collectionId, coll);
    }
    return coll;
  }

  private resolveCollections(filter?: CollectionFilter): CollectionId[] {
    if (filter === undefined) {
      return [...this.collections.keys()];
    }
    const filters = Array.isArray(filter) ? filter : [filter];
    if (filters.some(isCollectionPrefix)) {
      return apiResolveCollections(filter, [...this.collections.keys()]);
    }
    return filters;
  }

  private *iterateEntries(
    collectionIds: CollectionId[],
  ): Iterable<[BlockId, Float32Array]> {
    for (const cid of collectionIds) {
      const coll = this.collections.get(cid);
      if (coll) {
        yield* coll.entries();
      }
    }
  }

  async getIndexInfo(): Promise<VectorIndexInfo> {
    this.ensureOpen();
    return { ...this.info };
  }

  async deleteIndex(): Promise<void> {
    this.ensureOpen();
    this.closed = true;
    this.collections.clear();
  }

  async search(params: {
    topK: number;
    embedding: Float32Array;
    collections?: CollectionFilter;
  }): Promise<SearchResult[]> {
    this.ensureOpen();
    this.validateDimensionality(params.embedding);
    const collIds = this.resolveCollections(params.collections);
    const entries = this.iterateEntries(collIds);
    const results = bruteForceSearch(params.embedding, entries, params.topK);
    if (params.collections !== undefined) {
      return results.map((r) => ({
        ...r,
        collectionId: this.findCollectionForBlock(r.blockId, collIds),
      }));
    }
    return results;
  }

  private findCollectionForBlock(
    blockId: BlockId,
    collectionIds: CollectionId[],
  ): CollectionId | undefined {
    for (const cid of collectionIds) {
      if (this.collections.get(cid)?.has(blockId)) return cid;
    }
    return undefined;
  }

  async addDocument(params: {
    blockId: BlockId;
    embedding: Float32Array;
    collectionId?: CollectionId;
  }): Promise<void> {
    this.ensureOpen();
    this.validateDimensionality(params.embedding);
    const cid = params.collectionId ?? DEFAULT_COLLECTION;
    this.getOrCreateCollection(cid).set(
      params.blockId,
      new Float32Array(params.embedding),
    );
  }

  async addDocuments(
    docs:
      | Iterable<{
          blockId: BlockId;
          embedding: Float32Array;
          collectionId?: CollectionId;
        }>
      | AsyncIterable<{
          blockId: BlockId;
          embedding: Float32Array;
          collectionId?: CollectionId;
        }>,
  ): Promise<void> {
    this.ensureOpen();
    for await (const doc of docs as AsyncIterable<{
      blockId: BlockId;
      embedding: Float32Array;
      collectionId?: CollectionId;
    }>) {
      await this.addDocument(doc);
    }
  }

  async deleteDocument(
    blockId: BlockId,
    collectionId?: CollectionId,
  ): Promise<void> {
    this.ensureOpen();
    if (collectionId !== undefined) {
      const coll = this.collections.get(collectionId);
      if (coll) {
        coll.delete(blockId);
        if (coll.size === 0) this.collections.delete(collectionId);
      }
    } else {
      for (const [cid, coll] of this.collections) {
        coll.delete(blockId);
        if (coll.size === 0) this.collections.delete(cid);
      }
    }
  }

  async deleteDocuments(
    blockIds: Iterable<BlockId> | AsyncIterable<BlockId>,
    collectionId?: CollectionId,
  ): Promise<void> {
    this.ensureOpen();
    for await (const blockId of blockIds as AsyncIterable<BlockId>) {
      await this.deleteDocument(blockId, collectionId);
    }
  }

  async deleteCollection(collectionId: CollectionId): Promise<void> {
    this.ensureOpen();
    this.collections.delete(collectionId);
  }

  async hasDocument(
    blockId: BlockId,
    collectionId?: CollectionId,
  ): Promise<boolean> {
    this.ensureOpen();
    if (collectionId !== undefined) {
      return this.collections.get(collectionId)?.has(blockId) ?? false;
    }
    for (const coll of this.collections.values()) {
      if (coll.has(blockId)) return true;
    }
    return false;
  }

  async getSize(collectionId?: CollectionId): Promise<number> {
    this.ensureOpen();
    if (collectionId !== undefined) {
      return this.collections.get(collectionId)?.size ?? 0;
    }
    let total = 0;
    for (const coll of this.collections.values()) {
      total += coll.size;
    }
    return total;
  }

  async getCollections(): Promise<CollectionId[]> {
    this.ensureOpen();
    return [...this.collections.keys()];
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Get the set of block IDs stored in this index (across all collections) */
  getBlockIds(): Set<string> {
    const ids = new Set<string>();
    for (const coll of this.collections.values()) {
      for (const id of coll.keys()) {
        ids.add(id);
      }
    }
    return ids;
  }

  /** Serialize embeddings to Arrow IPC format */
  serializeToArrow(): Uint8Array {
    const dim = this.info.dimensionality;
    const blockIds: string[] = [];
    const collectionIds: string[] = [];
    const embeddingArrays: number[][] = [];
    for (const [cid, coll] of this.collections) {
      for (const [blockId, emb] of coll) {
        collectionIds.push(cid);
        blockIds.push(blockId);
        embeddingArrays.push(Array.from(emb));
      }
    }
    const table = tableFromArrays(
      {
        collectionId: collectionIds,
        blockId: blockIds,
        embedding: embeddingArrays,
      },
      {
        types: {
          collectionId: utf8(),
          blockId: utf8(),
          embedding: fixedSizeList(float32(), dim),
        },
      },
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
    const collCol = table.getChild("collectionId");
    for (let i = 0; i < table.numRows; i++) {
      const blockId = blockIdCol.at(i) as string;
      const emb = new Float32Array(embCol.at(i) as ArrayLike<number>);
      const collectionId = collCol
        ? (collCol.at(i) as string)
        : DEFAULT_COLLECTION;
      vec.getOrCreateCollection(collectionId).set(blockId, emb);
    }
    return vec;
  }
}
