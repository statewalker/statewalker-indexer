import type {
  BlockId,
  FullTextIndex,
  HybridWeights,
  Index,
  Metadata,
  SearchResult,
  VectorIndex,
} from "@repo/indexer-api";
import { mergeByRRF, mergeByWeights } from "./hybrid-search.js";

export class PGLiteIndex implements Index {
  readonly name: string;
  readonly metadata?: Metadata;
  private readonly fts: FullTextIndex | null;
  private readonly vec: VectorIndex | null;
  private readonly trackedBlockIds = new Set<BlockId>();
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

  async search(params: {
    query?: string;
    embedding?: Float32Array;
    topK: number;
    weights?: HybridWeights;
  }): Promise<SearchResult[]> {
    this.ensureOpen();
    const { query, embedding, topK, weights } = params;

    const ftsAvailable = query !== undefined && this.fts !== null;
    const vecAvailable = embedding !== undefined && this.vec !== null;

    if (ftsAvailable && vecAvailable) {
      const [ftsResults, vecResults] = await Promise.all([
        this.fts.search({ query, topK }),
        this.vec.search({ embedding, topK }),
      ]);
      if (weights) {
        return mergeByWeights(ftsResults, vecResults, weights, topK);
      }
      return mergeByRRF(ftsResults, vecResults, topK);
    }

    if (ftsAvailable) {
      return this.fts.search({ query, topK });
    }

    if (vecAvailable) {
      return this.vec.search({ embedding, topK });
    }

    return [];
  }

  async addDocument(params: {
    blockId: BlockId;
    content?: string;
    embedding?: Float32Array;
    metadata?: Metadata;
  }): Promise<void> {
    this.ensureOpen();
    const { blockId, content, embedding, metadata } = params;

    let added = false;
    if (content !== undefined && this.fts !== null) {
      await this.fts.addDocument({ blockId, content, metadata });
      added = true;
    }
    if (embedding !== undefined && this.vec !== null) {
      await this.vec.addDocument({ blockId, embedding });
      added = true;
    }
    if (added) {
      this.trackedBlockIds.add(blockId);
    }
  }

  async addDocuments(
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
  ): Promise<void> {
    this.ensureOpen();
    for await (const doc of docs as AsyncIterable<{
      blockId: BlockId;
      content?: string;
      embedding?: Float32Array;
      metadata?: Metadata;
    }>) {
      await this.addDocument(doc);
    }
  }

  async deleteDocument(blockId: BlockId): Promise<void> {
    this.ensureOpen();
    if (this.fts !== null) {
      await this.fts.deleteDocument(blockId);
    }
    if (this.vec !== null) {
      await this.vec.deleteDocument(blockId);
    }
    this.trackedBlockIds.delete(blockId);
  }

  async deleteDocuments(
    blockIds: Iterable<BlockId> | AsyncIterable<BlockId>,
  ): Promise<void> {
    this.ensureOpen();
    for await (const blockId of blockIds as AsyncIterable<BlockId>) {
      await this.deleteDocument(blockId);
    }
  }

  async hasDocument(blockId: BlockId): Promise<boolean> {
    this.ensureOpen();
    if (this.fts !== null && (await this.fts.hasDocument(blockId))) return true;
    if (this.vec !== null && (await this.vec.hasDocument(blockId))) return true;
    return false;
  }

  async getSize(): Promise<number> {
    this.ensureOpen();
    return this.trackedBlockIds.size;
  }

  getFullTextIndex(): FullTextIndex | null {
    return this.fts;
  }

  getVectorIndex(): VectorIndex | null {
    return this.vec;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.fts !== null) await this.fts.close();
    if (this.vec !== null) await this.vec.close();
  }
}
