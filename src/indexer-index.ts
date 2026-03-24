import type { FullTextIndex } from "./full-text-index.js";
import type {
  BlockId,
  HybridWeights,
  Metadata,
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
  }): Promise<SearchResult[]>;

  addDocument(params: {
    blockId: BlockId;
    content?: string;
    embedding?: Float32Array;
    metadata?: Metadata;
  }): Promise<void>;
  addDocuments(
    docs:
      | Iterable<{
          blockId: BlockId;
          content?: string;
          embedding?: Float32Array;
          metadata?: Metadata;
        }>
      | AsyncIterable<{
          blockId: BlockId;
          content?: string;
          embedding?: Float32Array;
          metadata?: Metadata;
        }>,
  ): Promise<void>;

  deleteDocument(blockId: BlockId): Promise<void>;
  deleteDocuments(
    blockIds: Iterable<BlockId> | AsyncIterable<BlockId>,
  ): Promise<void>;

  hasDocument(blockId: BlockId): Promise<boolean>;
  getSize(): Promise<number>;

  getFullTextIndex(): FullTextIndex | null;
  getVectorIndex(): VectorIndex | null;

  close(options?: { force?: boolean }): Promise<void>;
}
