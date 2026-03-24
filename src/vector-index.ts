import type { BlockId, Metadata, SearchResult } from "./types.js";

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
  }): Promise<SearchResult[]>;

  addDocument(params: {
    blockId: BlockId;
    embedding: Float32Array;
  }): Promise<void>;
  addDocuments(
    docs:
      | Iterable<{ blockId: BlockId; embedding: Float32Array }>
      | AsyncIterable<{ blockId: BlockId; embedding: Float32Array }>,
  ): Promise<void>;

  deleteDocument(blockId: BlockId): Promise<void>;
  deleteDocuments(
    blockIds: Iterable<BlockId> | AsyncIterable<BlockId>,
  ): Promise<void>;

  hasDocument(blockId: BlockId): Promise<boolean>;
  getSize(): Promise<number>;
  close(): Promise<void>;
}
