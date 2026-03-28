import {
  resolveCollections as apiResolveCollections,
  type BlockId,
  type CollectionFilter,
  type CollectionId,
  DEFAULT_COLLECTION,
  type FullTextIndex,
  type FullTextIndexInfo,
  isCollectionPrefix,
  type Metadata,
  type SearchResult,
} from "@repo/indexer-api";
import FlexSearch from "flexsearch";

interface CollectionState {
  flexIndex: FlexSearch.Index;
  blockIdToNum: Map<string, number>;
  numToBlockId: Map<number, string>;
  nextNum: number;
}

function createCollectionState(): CollectionState {
  return {
    flexIndex: new FlexSearch.Index({
      tokenize: "forward",
      resolution: 9,
      cache: true,
    }),
    blockIdToNum: new Map(),
    numToBlockId: new Map(),
    nextNum: 1,
  };
}

export class FlexSearchFullTextIndex implements FullTextIndex {
  private readonly info: FullTextIndexInfo;
  private readonly collections = new Map<CollectionId, CollectionState>();
  private closed = false;

  constructor(info: FullTextIndexInfo) {
    this.info = info;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("FullTextIndex is closed");
    }
  }

  private getOrCreateCollection(collectionId: CollectionId): CollectionState {
    let state = this.collections.get(collectionId);
    if (!state) {
      state = createCollectionState();
      this.collections.set(collectionId, state);
    }
    return state;
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

  private getOrAssignNum(state: CollectionState, blockId: BlockId): number {
    let num = state.blockIdToNum.get(blockId);
    if (num === undefined) {
      num = state.nextNum++;
      state.blockIdToNum.set(blockId, num);
      state.numToBlockId.set(num, blockId);
    }
    return num;
  }

  private searchCollection(
    state: CollectionState,
    query: string,
    topK: number,
    collectionId: CollectionId,
    includeCollectionId: boolean,
  ): SearchResult[] {
    const ids = state.flexIndex.search(query, topK) as number[];

    if (ids.length === 0) {
      const words = query.split(/\s+/).filter((w) => w.length > 1);
      const scores = new Map<number, number>();
      for (const word of words) {
        const wordIds = state.flexIndex.search(word, topK) as number[];
        for (let i = 0; i < wordIds.length; i++) {
          const numId = wordIds[i]!;
          scores.set(numId, (scores.get(numId) ?? 0) + 1 - i / wordIds.length);
        }
      }
      const sorted = [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topK);
      return sorted.map(([numId, score]) => ({
        blockId: state.numToBlockId.get(numId) ?? String(numId),
        score,
        ...(includeCollectionId ? { collectionId } : {}),
      }));
    }

    return ids.map((numId, rank) => ({
      blockId: state.numToBlockId.get(numId) ?? String(numId),
      score: 1 - rank / ids.length,
      ...(includeCollectionId ? { collectionId } : {}),
    }));
  }

  async getIndexInfo(): Promise<FullTextIndexInfo> {
    this.ensureOpen();
    return { ...this.info };
  }

  async deleteIndex(): Promise<void> {
    this.ensureOpen();
    this.closed = true;
    this.collections.clear();
  }

  async search(params: {
    query: string;
    topK: number;
    collections?: CollectionFilter;
  }): Promise<SearchResult[]> {
    this.ensureOpen();
    const collIds = this.resolveCollections(params.collections);
    const includeCollectionId = params.collections !== undefined;
    const allResults: SearchResult[] = [];

    for (const cid of collIds) {
      const state = this.collections.get(cid);
      if (!state) continue;
      const results = this.searchCollection(
        state,
        params.query,
        params.topK,
        cid,
        includeCollectionId,
      );
      allResults.push(...results);
    }

    allResults.sort((a, b) => b.score - a.score);
    return allResults.slice(0, params.topK);
  }

  async addDocument(params: {
    blockId: BlockId;
    content: string;
    metadata?: Metadata;
    collectionId?: CollectionId;
  }): Promise<void> {
    this.ensureOpen();
    const cid = params.collectionId ?? DEFAULT_COLLECTION;
    const state = this.getOrCreateCollection(cid);
    const num = this.getOrAssignNum(state, params.blockId);
    if (state.blockIdToNum.has(params.blockId)) {
      state.flexIndex.remove(num);
    }
    state.flexIndex.add(num, params.content);
  }

  async addDocuments(
    docs:
      | Iterable<{
          blockId: BlockId;
          content: string;
          metadata?: Metadata;
          collectionId?: CollectionId;
        }>
      | AsyncIterable<{
          blockId: BlockId;
          content: string;
          metadata?: Metadata;
          collectionId?: CollectionId;
        }>,
  ): Promise<void> {
    this.ensureOpen();
    for await (const doc of docs as AsyncIterable<{
      blockId: BlockId;
      content: string;
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
    if (collectionId !== undefined) {
      this.removeFromCollection(blockId, collectionId);
    } else {
      for (const cid of this.collections.keys()) {
        this.removeFromCollection(blockId, cid);
      }
    }
  }

  private removeFromCollection(
    blockId: BlockId,
    collectionId: CollectionId,
  ): void {
    const state = this.collections.get(collectionId);
    if (!state) return;
    const num = state.blockIdToNum.get(blockId);
    if (num !== undefined) {
      state.flexIndex.remove(num);
      state.blockIdToNum.delete(blockId);
      state.numToBlockId.delete(num);
      if (state.blockIdToNum.size === 0) {
        this.collections.delete(collectionId);
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
      return (
        this.collections.get(collectionId)?.blockIdToNum.has(blockId) ?? false
      );
    }
    for (const state of this.collections.values()) {
      if (state.blockIdToNum.has(blockId)) return true;
    }
    return false;
  }

  async getSize(collectionId?: CollectionId): Promise<number> {
    this.ensureOpen();
    if (collectionId !== undefined) {
      return this.collections.get(collectionId)?.blockIdToNum.size ?? 0;
    }
    let total = 0;
    for (const state of this.collections.values()) {
      total += state.blockIdToNum.size;
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

  /** Export FlexSearch native chunks as key/value pairs per collection */
  async exportChunks(): Promise<Map<string, string>> {
    const chunks = new Map<string, string>();
    for (const [cid, state] of this.collections) {
      const collChunks = new Map<string, string>();
      await state.flexIndex.export((key: string | number, data: string) => {
        collChunks.set(String(key), data);
      });
      chunks.set(
        `coll:${cid}`,
        JSON.stringify({
          chunks: Object.fromEntries(collChunks),
          blockIds: [...state.blockIdToNum.entries()],
          nextNum: state.nextNum,
        }),
      );
    }
    return chunks;
  }

  /** Serialize to JSON string */
  async serialize(): Promise<string> {
    const collectionsData: Record<
      string,
      {
        chunks: Record<string, string>;
        blockIds: Array<[string, number]>;
        nextNum: number;
      }
    > = {};

    for (const [cid, state] of this.collections) {
      const chunks = new Map<string, string>();
      await state.flexIndex.export((key: string | number, data: string) => {
        chunks.set(String(key), data);
      });
      collectionsData[cid] = {
        chunks: Object.fromEntries(chunks),
        blockIds: [...state.blockIdToNum.entries()],
        nextNum: state.nextNum,
      };
    }

    return JSON.stringify({ version: 2, collections: collectionsData });
  }

  /** Import from serialized data — handles both legacy (v1) and new (v2) format */
  static deserialize(
    info: FullTextIndexInfo,
    json: string,
  ): FlexSearchFullTextIndex {
    const parsed = JSON.parse(json) as {
      version?: number;
      // v2 format
      collections?: Record<
        string,
        {
          chunks: Record<string, string>;
          blockIds: Array<[string, number]>;
          nextNum: number;
        }
      >;
      // v1 (legacy) format
      chunks?: Record<string, string>;
      blockIds?: Array<[string, number]>;
      nextNum?: number;
    };

    const fts = new FlexSearchFullTextIndex(info);

    if (parsed.version === 2 && parsed.collections) {
      for (const [cid, collData] of Object.entries(parsed.collections)) {
        const state = createCollectionState();
        const chunks = new Map(Object.entries(collData.chunks));
        for (const [key, data] of chunks) {
          state.flexIndex.import(key, data);
        }
        for (const [blockId, num] of collData.blockIds) {
          state.blockIdToNum.set(blockId, num);
          state.numToBlockId.set(num, blockId);
        }
        state.nextNum = collData.nextNum;
        fts.collections.set(cid, state);
      }
    } else if (parsed.chunks && parsed.blockIds && parsed.nextNum) {
      // Legacy v1 format — put everything in _default collection
      const state = createCollectionState();
      const chunks = new Map(Object.entries(parsed.chunks));
      for (const [key, data] of chunks) {
        state.flexIndex.import(key, data);
      }
      for (const [blockId, num] of parsed.blockIds) {
        state.blockIdToNum.set(blockId, num);
        state.numToBlockId.set(num, blockId);
      }
      state.nextNum = parsed.nextNum;
      fts.collections.set(DEFAULT_COLLECTION, state);
    }

    return fts;
  }

  /** Get all block IDs across all collections (for persistence restore) */
  getAllBlockIds(): Set<string> {
    const ids = new Set<string>();
    for (const state of this.collections.values()) {
      for (const blockId of state.blockIdToNum.keys()) {
        ids.add(blockId);
      }
    }
    return ids;
  }
}
