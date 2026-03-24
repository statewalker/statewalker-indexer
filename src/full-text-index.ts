import type { BlockId, Metadata, SearchResult } from "./types.js";

export interface FullTextIndexInfo {
  language: string;
  metadata?: Metadata;
}

export interface FullTextIndex {
  getIndexInfo(): Promise<FullTextIndexInfo>;
  deleteIndex(): Promise<void>;

  search(params: { query: string; topK: number }): Promise<SearchResult[]>;

  addDocument(params: {
    blockId: BlockId;
    content: string;
    metadata?: Metadata;
  }): Promise<void>;
  addDocuments(
    docs:
      | Iterable<{ blockId: BlockId; content: string; metadata?: Metadata }>
      | AsyncIterable<{
          blockId: BlockId;
          content: string;
          metadata?: Metadata;
        }>,
  ): Promise<void>;

  deleteDocument(blockId: BlockId): Promise<void>;
  deleteDocuments(
    blockIds: Iterable<BlockId> | AsyncIterable<BlockId>,
  ): Promise<void>;

  hasDocument(blockId: BlockId): Promise<boolean>;
  getSize(): Promise<number>;
  close(): Promise<void>;
}
