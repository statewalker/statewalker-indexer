import type { FullTextIndex } from "./full-text-index.js";
import type {
  BlockId,
  CollectionFilter,
  CollectionId,
  HybridWeights,
  Metadata,
  MultiSearchParams,
  MultiSearchResult,
  SearchResult,
} from "./types.js";
import type { VectorIndex } from "./vector-index.js";

export interface Index {
  readonly name: string;
  readonly metadata?: Metadata;

  search(params: {
    query?: string;
    embedding?: Float32Array;
    topK: number;
    weights?: HybridWeights;
    collections?: CollectionFilter;
  }): Promise<SearchResult[]>;

  multiSearch?(params: MultiSearchParams): Promise<MultiSearchResult>;

  addDocument(params: {
    blockId: BlockId;
    content?: string;
    embedding?: Float32Array;
    metadata?: Metadata;
    collectionId?: CollectionId;
  }): Promise<void>;
  addDocuments(
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

  getFullTextIndex(): FullTextIndex | null;
  getVectorIndex(): VectorIndex | null;

  close(options?: { force?: boolean }): Promise<void>;
}
