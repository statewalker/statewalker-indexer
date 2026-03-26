import type {
  BlockId,
  CollectionFilter,
  CollectionId,
  Metadata,
  SearchResult,
} from "./types.js";

export interface VectorIndexInfo {
  dimensionality: number;
  model: string;
  metadata?: Metadata;
}

export interface VectorIndex {
  getIndexInfo(): Promise<VectorIndexInfo>;
  deleteIndex(): Promise<void>;

  search(params: {
    topK: number;
    embedding: Float32Array;
    collections?: CollectionFilter;
  }): Promise<SearchResult[]>;

  addDocument(params: {
    blockId: BlockId;
    embedding: Float32Array;
    collectionId?: CollectionId;
  }): Promise<void>;
  addDocuments(
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
