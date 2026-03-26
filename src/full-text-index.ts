import type {
  BlockId,
  CollectionFilter,
  CollectionId,
  Metadata,
  SearchResult,
} from "./types.js";

export interface FullTextIndexInfo {
  language: string;
  metadata?: Metadata;
}

export interface FullTextIndex {
  getIndexInfo(): Promise<FullTextIndexInfo>;
  deleteIndex(): Promise<void>;

  search(params: {
    query: string;
    topK: number;
    collections?: CollectionFilter;
  }): Promise<SearchResult[]>;

  addDocument(params: {
    blockId: BlockId;
    content: string;
    metadata?: Metadata;
    collectionId?: CollectionId;
  }): Promise<void>;
  addDocuments(
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
  ): Promise<void>;

  deleteDocument(blockId: BlockId, collectionId?: CollectionId): Promise<void>;
  deleteDocuments(
    blockIds: Iterable<BlockId> | AsyncIterable<BlockId>,
    collectionId?: CollectionId,
  ): Promise<void>;
  deleteCollection(collectionId: CollectionId): Promise<void>;

  hasDocument(blockId: BlockId, collectionId?: CollectionId): Promise<boolean>;
  getSize(collectionId?: CollectionId): Promise<number>;
  getCollections(): Promise<CollectionId[]>;
  close(): Promise<void>;
}
