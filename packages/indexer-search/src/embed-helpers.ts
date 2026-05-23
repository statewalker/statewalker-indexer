import type {
  DocumentPath,
  EmbedFn,
  HybridSearchResult,
  HybridWeights,
  Index,
  IndexedBlock,
  Metadata,
} from "@statewalker/indexer-api";

export interface EmbedDoc {
  path: DocumentPath;
  blockId: string;
  content: string;
  embeddingContent?: string;
  metadata?: Metadata;
}

export interface EmbedSearchParams {
  query: string;
  semanticQuery?: string;
  topK: number;
  weights?: HybridWeights;
  paths?: DocumentPath[];
}

export async function embedAndAdd(
  index: Index,
  embed: EmbedFn,
  docs: Iterable<EmbedDoc> | AsyncIterable<EmbedDoc>,
): Promise<void> {
  const hasVector = index.getVectorIndex() !== null;

  async function* toBatches(source: typeof docs): AsyncGenerator<IndexedBlock[]> {
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
  }

  return index.addDocuments(toBatches(docs));
}

export async function embedAndSearch(
  index: Index,
  embed: EmbedFn,
  params: EmbedSearchParams,
): Promise<HybridSearchResult[]> {
  const { query, semanticQuery, topK, weights, paths } = params;
  const hasVector = index.getVectorIndex() !== null;

  const searchParams = hasVector
    ? {
        queries: [query],
        embeddings: [await embed(semanticQuery ?? query)],
        topK,
        weights,
        paths,
      }
    : { queries: [query], topK, weights, paths };

  const results: HybridSearchResult[] = [];
  for await (const r of index.search(searchParams)) {
    results.push(r);
  }
  return results;
}
