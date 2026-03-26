import {
  type BlockId,
  type CollectionFilter,
  type CollectionId,
  DEFAULT_COLLECTION,
  type FullTextIndex,
  type FullTextIndexInfo,
  type Metadata,
  type SearchResult,
} from "@repo/indexer-api";
import MiniSearch from "minisearch";

interface CollectionState {
  miniSearch: MiniSearch;
  blockIds: Set<string>;
}

function createCollectionState(): CollectionState {
  return {
    miniSearch: new MiniSearch({
      fields: ["content"],
      idField: "blockId",
    }),
    blockIds: new Set(),
  };
}

export class MiniSearchFullTextIndex implements FullTextIndex {
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
    return Array.isArray(filter) ? filter : [filter];
  }

  private searchCollection(
    state: CollectionState,
    query: string,
    topK: number,
    collectionId: CollectionId,
    includeCollectionId: boolean,
  ): SearchResult[] {
    let results = state.miniSearch.search(query, {
      prefix: true,
      fuzzy: 0.2,
    });

    if (results.length === 0) {
      results = state.miniSearch.search(query, {
        prefix: true,
      });
    }

    if (results.length === 0) {
      const words = query.split(/\s+/).filter((w) => w.length > 1);
      if (words.length > 1) {
        results = state.miniSearch.search(query, {
          prefix: true,
          fuzzy: 0.2,
          combineWith: "OR",
        });
      }
    }

    return results.slice(0, topK).map((r) => ({
      blockId: r.id as BlockId,
      score: r.score,
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
    if (state.blockIds.has(params.blockId)) {
      state.miniSearch.discard(params.blockId);
    }
    state.miniSearch.add({ blockId: params.blockId, content: params.content });
    state.blockIds.add(params.blockId);
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
    if (state.blockIds.has(blockId)) {
      state.miniSearch.discard(blockId);
      state.blockIds.delete(blockId);
      if (state.blockIds.size === 0) {
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
      return this.collections.get(collectionId)?.blockIds.has(blockId) ?? false;
    }
    for (const state of this.collections.values()) {
      if (state.blockIds.has(blockId)) return true;
    }
    return false;
  }

  async getSize(collectionId?: CollectionId): Promise<number> {
    this.ensureOpen();
    if (collectionId !== undefined) {
      return this.collections.get(collectionId)?.blockIds.size ?? 0;
    }
    let total = 0;
    for (const state of this.collections.values()) {
      total += state.blockIds.size;
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

  /** Serialize using MiniSearch native toJSON */
  serialize(): string {
    const collectionsData: Record<
      string,
      { miniSearch: unknown; blockIds: string[] }
    > = {};

    for (const [cid, state] of this.collections) {
      collectionsData[cid] = {
        miniSearch: state.miniSearch.toJSON(),
        blockIds: [...state.blockIds],
      };
    }

    return JSON.stringify({ version: 2, collections: collectionsData });
  }

  /** Deserialize — handles both legacy (v1) and new (v2) format */
  static deserialize(
    info: FullTextIndexInfo,
    json: string,
  ): MiniSearchFullTextIndex {
    const parsed = JSON.parse(json) as {
      version?: number;
      // v2 format
      collections?: Record<string, { miniSearch: unknown; blockIds: string[] }>;
      // v1 (legacy) format
      miniSearch?: unknown;
      blockIds?: string[];
    };

    const index = new MiniSearchFullTextIndex(info);
    const opts = { fields: ["content"], idField: "blockId" };

    if (parsed.version === 2 && parsed.collections) {
      for (const [cid, collData] of Object.entries(parsed.collections)) {
        const state = createCollectionState();
        state.miniSearch = MiniSearch.loadJSON(
          JSON.stringify(collData.miniSearch),
          opts,
        );
        state.blockIds = new Set(collData.blockIds);
        index.collections.set(cid, state);
      }
    } else if (parsed.miniSearch && parsed.blockIds) {
      // Legacy v1 format
      const state = createCollectionState();
      state.miniSearch = MiniSearch.loadJSON(
        JSON.stringify(parsed.miniSearch),
        opts,
      );
      state.blockIds = new Set(parsed.blockIds);
      index.collections.set(DEFAULT_COLLECTION, state);
    }

    return index;
  }

  /** Get all block IDs across all collections (for persistence restore) */
  getAllBlockIds(): Set<string> {
    const ids = new Set<string>();
    for (const state of this.collections.values()) {
      for (const blockId of state.blockIds) {
        ids.add(blockId);
      }
    }
    return ids;
  }
}
