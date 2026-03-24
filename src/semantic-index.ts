import type { Index } from "./indexer-index.js";
import type {
  BlockId,
  HybridWeights,
  Metadata,
  SearchResult,
} from "./types.js";

export type EmbedFn = (text: string) => Promise<Float32Array>;

export class SemanticIndex {
  readonly index: Index;
  private readonly embed: EmbedFn;

  constructor(index: Index, embed: EmbedFn) {
    this.index = index;
    this.embed = embed;
  }

  async search(params: {
    query: string;
    semanticQuery?: string;
    topK: number;
    weights?: HybridWeights;
  }): Promise<SearchResult[]> {
    const { query, semanticQuery, topK, weights } = params;
    const hasVector = this.index.getVectorIndex() !== null;

    if (hasVector) {
      const embedding = await this.embed(semanticQuery ?? query);
      return this.index.search({ query, embedding, topK, weights });
    }
    return this.index.search({ query, topK, weights });
  }

  async addDocument(params: {
    blockId: BlockId;
    content: string;
    embeddingContent?: string;
    metadata?: Metadata;
  }): Promise<void> {
    const { blockId, content, embeddingContent, metadata } = params;
    const hasVector = this.index.getVectorIndex() !== null;

    if (hasVector) {
      const embedding = await this.embed(embeddingContent ?? content);
      return this.index.addDocument({ blockId, content, embedding, metadata });
    }
    return this.index.addDocument({ blockId, content, metadata });
  }

  async addDocuments(
    docs:
      | Iterable<{
          blockId: BlockId;
          content: string;
          embeddingContent?: string;
          metadata?: Metadata;
        }>
      | AsyncIterable<{
          blockId: BlockId;
          content: string;
          embeddingContent?: string;
          metadata?: Metadata;
        }>,
  ): Promise<void> {
    const hasVector = this.index.getVectorIndex() !== null;

    const mapped = async function* (
      embed: EmbedFn,
      source:
        | Iterable<{
            blockId: BlockId;
            content: string;
            embeddingContent?: string;
            metadata?: Metadata;
          }>
        | AsyncIterable<{
            blockId: BlockId;
            content: string;
            embeddingContent?: string;
            metadata?: Metadata;
          }>,
    ) {
      for await (const doc of source) {
        if (hasVector) {
          const embedding = await embed(doc.embeddingContent ?? doc.content);
          yield {
            blockId: doc.blockId,
            content: doc.content,
            embedding,
            metadata: doc.metadata,
          };
        } else {
          yield {
            blockId: doc.blockId,
            content: doc.content,
            metadata: doc.metadata,
          };
        }
      }
    };

    return this.index.addDocuments(mapped(this.embed, docs));
  }

  async deleteDocument(blockId: BlockId): Promise<void> {
    return this.index.deleteDocument(blockId);
  }

  async deleteDocuments(
    blockIds: Iterable<BlockId> | AsyncIterable<BlockId>,
  ): Promise<void> {
    return this.index.deleteDocuments(blockIds);
  }

  async hasDocument(blockId: BlockId): Promise<boolean> {
    return this.index.hasDocument(blockId);
  }

  async getSize(): Promise<number> {
    return this.index.getSize();
  }

  async close(): Promise<void> {
    return this.index.close();
  }
}
