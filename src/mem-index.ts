import type {
  BlockId,
  CollectionFilter,
  CollectionId,
  FullTextIndex,
  HybridWeights,
  Index,
  Metadata,
  SearchResult,
  VectorIndex,
} from "@repo/indexer-api";
import { DEFAULT_COLLECTION } from "@repo/indexer-api";
import { mergeByRRF, mergeByWeights } from "./hybrid-search.js";

export class MemIndex implements Index {
  readonly name: string;
  readonly metadata?: Metadata;
  private readonly fts: FullTextIndex | null;
  private readonly vec: VectorIndex | null;
  private readonly trackedBlockIds = new Map<CollectionId, Set<BlockId>>();
  private closed = false;

  constructor(
    name: string,
    fts: FullTextIndex | null,
    vec: VectorIndex | null,
    metadata?: Metadata,
  ) {
    this.name = name;
    this.fts = fts;
    this.vec = vec;
    this.metadata = metadata;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error(`Index "${this.name}" is closed`);
    }
  }

  private trackBlock(blockId: BlockId, collectionId: CollectionId): void {
    let set = this.trackedBlockIds.get(collectionId);
    if (!set) {
      set = new Set();
      this.trackedBlockIds.set(collectionId, set);
    }
    set.add(blockId);
  }

  private untrackBlock(blockId: BlockId, collectionId?: CollectionId): void {
    if (collectionId !== undefined) {
      const set = this.trackedBlockIds.get(collectionId);
      if (set) {
        set.delete(blockId);
        if (set.size === 0) this.trackedBlockIds.delete(collectionId);
      }
    } else {
      for (const [cid, set] of this.trackedBlockIds) {
        set.delete(blockId);
        if (set.size === 0) this.trackedBlockIds.delete(cid);
      }
    }
  }

  async search(params: {
    query?: string;
    embedding?: Float32Array;
    topK: number;
    weights?: HybridWeights;
    collections?: CollectionFilter;
  }): Promise<SearchResult[]> {
    this.ensureOpen();
    const { query, embedding, topK, weights, collections } = params;

    const ftsAvailable = query !== undefined && this.fts !== null;
    const vecAvailable = embedding !== undefined && this.vec !== null;

    if (ftsAvailable && vecAvailable) {
      const [ftsResults, vecResults] = await Promise.all([
        this.fts.search({ query, topK, collections }),
        this.vec.search({ embedding, topK, collections }),
      ]);
      if (weights) {
        return mergeByWeights(ftsResults, vecResults, weights, topK);
      }
      return mergeByRRF(ftsResults, vecResults, topK);
    }

    if (ftsAvailable) {
      return this.fts.search({ query, topK, collections });
    }

    if (vecAvailable) {
      return this.vec.search({ embedding, topK, collections });
    }

    return [];
  }

  async addDocument(params: {
    blockId: BlockId;
    content?: string;
    embedding?: Float32Array;
    metadata?: Metadata;
    collectionId?: CollectionId;
  }): Promise<void> {
    this.ensureOpen();
    const { blockId, content, embedding, metadata, collectionId } = params;
    const cid = collectionId ?? DEFAULT_COLLECTION;

    let added = false;
    if (content !== undefined && this.fts !== null) {
      await this.fts.addDocument({
        blockId,
        content,
        metadata,
        collectionId: cid,
      });
      added = true;
    }
    if (embedding !== undefined && this.vec !== null) {
      await this.vec.addDocument({ blockId, embedding, collectionId: cid });
      added = true;
    }
    if (added) {
      this.trackBlock(blockId, cid);
    }
  }

  async addDocuments(
    docs:
      | Iterable<{
          blockId: BlockId;
          content?: string;
          embedding?: Float32Array;
          metadata?: Metadata;
          collectionId?: CollectionId;
        }>
      | AsyncIterable<{
          blockId: BlockId;
          content?: string;
          embedding?: Float32Array;
          metadata?: Metadata;
          collectionId?: CollectionId;
        }>,
  ): Promise<void> {
    this.ensureOpen();
    for await (const doc of docs as AsyncIterable<{
      blockId: BlockId;
      content?: string;
      embedding?: Float32Array;
      metadata?: Metadata;
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
    if (this.fts !== null) {
      await this.fts.deleteDocument(blockId, collectionId);
    }
    if (this.vec !== null) {
      await this.vec.deleteDocument(blockId, collectionId);
    }
    this.untrackBlock(blockId, collectionId);
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
    if (this.fts !== null) {
      await this.fts.deleteCollection(collectionId);
    }
    if (this.vec !== null) {
      await this.vec.deleteCollection(collectionId);
    }
    this.trackedBlockIds.delete(collectionId);
  }

  async hasDocument(
    blockId: BlockId,
    collectionId?: CollectionId,
  ): Promise<boolean> {
    this.ensureOpen();
    if (collectionId !== undefined) {
      if (
        this.fts !== null &&
        (await this.fts.hasDocument(blockId, collectionId))
      )
        return true;
      if (
        this.vec !== null &&
        (await this.vec.hasDocument(blockId, collectionId))
      )
        return true;
      return false;
    }
    if (this.fts !== null && (await this.fts.hasDocument(blockId))) return true;
    if (this.vec !== null && (await this.vec.hasDocument(blockId))) return true;
    return false;
  }

  async getSize(collectionId?: CollectionId): Promise<number> {
    this.ensureOpen();
    if (collectionId !== undefined) {
      return this.trackedBlockIds.get(collectionId)?.size ?? 0;
    }
    let total = 0;
    for (const set of this.trackedBlockIds.values()) {
      total += set.size;
    }
    return total;
  }

  async getCollections(): Promise<CollectionId[]> {
    this.ensureOpen();
    return [...this.trackedBlockIds.keys()];
  }

  getFullTextIndex(): FullTextIndex | null {
    return this.fts;
  }

  getVectorIndex(): VectorIndex | null {
    return this.vec;
  }

  restoreTrackedBlockIds(
    blockIds: Iterable<BlockId>,
    collectionId?: CollectionId,
  ): void {
    const cid = collectionId ?? DEFAULT_COLLECTION;
    let set = this.trackedBlockIds.get(cid);
    if (!set) {
      set = new Set();
      this.trackedBlockIds.set(cid, set);
    }
    for (const id of blockIds) {
      set.add(id);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.fts !== null) await this.fts.close();
    if (this.vec !== null) await this.vec.close();
  }
}
