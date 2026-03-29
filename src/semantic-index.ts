import type {
  DocumentPath,
  HybridSearchResult,
  HybridWeights,
  Index,
  IndexedBlock,
  Metadata,
  PathSelector,
} from "./indexer-index.js";

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
    paths?: DocumentPath[];
  }): Promise<HybridSearchResult[]> {
    const { query, semanticQuery, topK, weights, paths } = params;
    const hasVector = this.index.getVectorIndex() !== null;

    const searchParams = hasVector
      ? {
          queries: [query],
          embeddings: [await this.embed(semanticQuery ?? query)],
          topK,
          weights,
          paths,
        }
      : { queries: [query], topK, weights, paths };

    const results: HybridSearchResult[] = [];
    for await (const r of this.index.search(searchParams)) {
      results.push(r);
    }
    return results;
  }

  async addDocument(params: {
    path: DocumentPath;
    blockId: string;
    content: string;
    embeddingContent?: string;
    metadata?: Metadata;
  }): Promise<void> {
    const { path, blockId, content, embeddingContent, metadata } = params;
    const hasVector = this.index.getVectorIndex() !== null;

    const block: IndexedBlock = { path, blockId, content, metadata };
    if (hasVector) {
      block.embedding = await this.embed(embeddingContent ?? content);
    }
    return this.index.addDocument([block]);
  }

  async addDocuments(
    docs:
      | Iterable<{
          path: DocumentPath;
          blockId: string;
          content: string;
          embeddingContent?: string;
          metadata?: Metadata;
        }>
      | AsyncIterable<{
          path: DocumentPath;
          blockId: string;
          content: string;
          embeddingContent?: string;
          metadata?: Metadata;
        }>,
  ): Promise<void> {
    const hasVector = this.index.getVectorIndex() !== null;
    const embed = this.embed;

    const mapped = async function* (
      source: typeof docs,
    ): AsyncGenerator<IndexedBlock[]> {
      for await (const doc of source) {
        const block: IndexedBlock = {
          path: doc.path,
          blockId: doc.blockId,
          content: doc.content,
          metadata: doc.metadata,
        };
        if (hasVector) {
          block.embedding = await embed(doc.embeddingContent ?? doc.content);
        }
        yield [block];
      }
    };

    return this.index.addDocuments(mapped(docs));
  }

  async deleteDocuments(pathSelectors: PathSelector[]): Promise<void> {
    return this.index.deleteDocuments(pathSelectors);
  }

  async getSize(pathPrefix?: DocumentPath): Promise<number> {
    return this.index.getSize(pathPrefix);
  }

  async *getDocumentPaths(
    pathPrefix?: DocumentPath,
  ): AsyncGenerator<DocumentPath> {
    yield* this.index.getDocumentPaths(pathPrefix);
  }

  async close(): Promise<void> {
    return this.index.close();
  }
}
