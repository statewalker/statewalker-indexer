import type { Index } from "./indexer-index.js";
import type {
  BlockId,
  CollectionFilter,
  CollectionId,
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
    collections?: CollectionFilter;
  }): Promise<SearchResult[]> {
    const { query, semanticQuery, topK, weights, collections } = params;
    const hasVector = this.index.getVectorIndex() !== null;

    if (hasVector) {
      const embedding = await this.embed(semanticQuery ?? query);
      return this.index.search({
        query,
        embedding,
        topK,
        weights,
        collections,
      });
    }
    return this.index.search({ query, topK, weights, collections });
  }

  async addDocument(params: {
    blockId: BlockId;
    content: string;
    embeddingContent?: string;
    metadata?: Metadata;
    collectionId?: CollectionId;
  }): Promise<void> {
    const { blockId, content, embeddingContent, metadata, collectionId } =
      params;
    const hasVector = this.index.getVectorIndex() !== null;

    if (hasVector) {
      const embedding = await this.embed(embeddingContent ?? content);
      return this.index.addDocument({
        blockId,
        content,
        embedding,
        metadata,
        collectionId,
      });
    }
    return this.index.addDocument({ blockId, content, metadata, collectionId });
  }

  async addDocuments(
    docs:
      | Iterable<{
          blockId: BlockId;
          content: string;
          embeddingContent?: string;
          metadata?: Metadata;
          collectionId?: CollectionId;
        }>
      | AsyncIterable<{
          blockId: BlockId;
          content: string;
          embeddingContent?: string;
          metadata?: Metadata;
          collectionId?: CollectionId;
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
            collectionId?: CollectionId;
          }>
        | AsyncIterable<{
            blockId: BlockId;
            content: string;
            embeddingContent?: string;
            metadata?: Metadata;
            collectionId?: CollectionId;
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
            collectionId: doc.collectionId,
          };
        } else {
          yield {
            blockId: doc.blockId,
            content: doc.content,
            metadata: doc.metadata,
            collectionId: doc.collectionId,
          };
        }
      }
    };

    return this.index.addDocuments(mapped(this.embed, docs));
  }

  async deleteDocument(
    blockId: BlockId,
    collectionId?: CollectionId,
  ): Promise<void> {
    return this.index.deleteDocument(blockId, collectionId);
  }

  async deleteDocuments(
    blockIds: Iterable<BlockId> | AsyncIterable<BlockId>,
    collectionId?: CollectionId,
  ): Promise<void> {
    return this.index.deleteDocuments(blockIds, collectionId);
  }

  async deleteCollection(collectionId: CollectionId): Promise<void> {
    return this.index.deleteCollection(collectionId);
  }

  async hasDocument(
    blockId: BlockId,
    collectionId?: CollectionId,
  ): Promise<boolean> {
    return this.index.hasDocument(blockId, collectionId);
  }

  async getSize(collectionId?: CollectionId): Promise<number> {
    return this.index.getSize(collectionId);
  }

  async getCollections(): Promise<CollectionId[]> {
    return this.index.getCollections();
  }

  async close(): Promise<void> {
    return this.index.close();
  }
}
