import type {
  BlockReference,
  DocumentPath,
  EmbeddingIndex,
  FullTextIndex,
  HybridSearchParams,
  HybridSearchResult,
  Index,
  IndexedBlock,
  Metadata,
  PathSelector,
} from "@repo/indexer-api";
import { mergeByRRF, mergeByWeights } from "./hybrid-search.js";

function compositeKey(path: DocumentPath, blockId: string): string {
  return `${path}\0${blockId}`;
}

function matchesPrefix(path: DocumentPath, prefix: DocumentPath): boolean {
  return path.startsWith(prefix);
}

export class MemIndex implements Index {
  readonly name: string;
  readonly metadata?: Metadata;
  private readonly fts: FullTextIndex | null;
  private readonly vec: EmbeddingIndex | null;
  private readonly trackedBlocks = new Map<
    string,
    { path: DocumentPath; blockId: string }
  >();
  private closed = false;

  constructor(
    name: string,
    fts: FullTextIndex | null,
    vec: EmbeddingIndex | null,
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

  async *search(
    params: HybridSearchParams,
  ): AsyncGenerator<HybridSearchResult> {
    this.ensureOpen();
    const { queries, embeddings, topK, weights, paths } = params;

    const hasQueries = queries && queries.length > 0 && this.fts !== null;
    const hasEmbeddings =
      embeddings && embeddings.length > 0 && this.vec !== null;

    if (!hasQueries && !hasEmbeddings) return;

    // Collect FTS results
    const ftsResults = [];
    if (hasQueries) {
      for await (const r of this.fts.search({
        queries,
        topK,
        paths,
      })) {
        ftsResults.push(r);
      }
    }

    // Collect embedding results
    const vecResults = [];
    if (hasEmbeddings) {
      for await (const r of this.vec.search({
        embeddings,
        topK,
        paths,
      })) {
        vecResults.push(r);
      }
    }

    // Merge
    let merged: HybridSearchResult[];
    if (ftsResults.length > 0 && vecResults.length > 0) {
      merged = weights
        ? mergeByWeights(ftsResults, vecResults, weights, topK)
        : mergeByRRF(ftsResults, vecResults, topK);
    } else if (ftsResults.length > 0) {
      merged = ftsResults.map((r) => ({
        path: r.path,
        blockId: r.blockId,
        score: r.score,
        fts: r,
        embedding: null,
      }));
    } else {
      merged = vecResults.map((r) => ({
        path: r.path,
        blockId: r.blockId,
        score: r.score,
        fts: null,
        embedding: r,
      }));
    }

    for (const r of merged.slice(0, topK)) {
      yield r;
    }
  }

  async addDocument(blocks: IndexedBlock[]): Promise<void> {
    this.ensureOpen();
    const ftsBlocks = [];
    const vecBlocks = [];

    for (const block of blocks) {
      if (block.content !== undefined && this.fts !== null) {
        ftsBlocks.push({
          path: block.path,
          blockId: block.blockId,
          content: block.content,
          metadata: block.metadata,
        });
      }
      if (block.embedding !== undefined && this.vec !== null) {
        vecBlocks.push({
          path: block.path,
          blockId: block.blockId,
          embedding: block.embedding,
          metadata: block.metadata,
        });
      }
      const key = compositeKey(block.path, block.blockId);
      this.trackedBlocks.set(key, {
        path: block.path,
        blockId: block.blockId,
      });
    }

    if (ftsBlocks.length > 0) await this.fts?.addDocument(ftsBlocks);
    if (vecBlocks.length > 0) await this.vec?.addDocument(vecBlocks);
  }

  async addDocuments(
    blocks: Iterable<IndexedBlock[]> | AsyncIterable<IndexedBlock[]>,
  ): Promise<void> {
    this.ensureOpen();
    for await (const batch of blocks) {
      await this.addDocument(batch);
    }
  }

  async deleteDocuments(
    pathSelectors: PathSelector[] | AsyncIterable<PathSelector>,
  ): Promise<void> {
    this.ensureOpen();
    const selectors: PathSelector[] = [];
    for await (const sel of pathSelectors as AsyncIterable<PathSelector>) {
      selectors.push(sel);
    }

    // Determine which tracked blocks match
    const toDelete: PathSelector[] = [];
    for (const sel of selectors) {
      if (sel.blockId !== undefined) {
        const key = compositeKey(sel.path, sel.blockId);
        if (this.trackedBlocks.has(key)) {
          this.trackedBlocks.delete(key);
          toDelete.push(sel);
        }
      } else {
        for (const [key, entry] of this.trackedBlocks) {
          if (matchesPrefix(entry.path, sel.path)) {
            this.trackedBlocks.delete(key);
            toDelete.push({ path: entry.path, blockId: entry.blockId });
          }
        }
      }
    }

    if (toDelete.length > 0) {
      if (this.fts !== null) await this.fts.deleteDocuments(toDelete);
      if (this.vec !== null) await this.vec.deleteDocuments(toDelete);
    }
  }

  async getSize(pathPrefix?: DocumentPath): Promise<number> {
    this.ensureOpen();
    if (pathPrefix === undefined) return this.trackedBlocks.size;
    let count = 0;
    for (const entry of this.trackedBlocks.values()) {
      if (matchesPrefix(entry.path, pathPrefix)) count++;
    }
    return count;
  }

  async *getDocumentPaths(
    pathPrefix?: DocumentPath,
  ): AsyncGenerator<DocumentPath> {
    this.ensureOpen();
    const paths = new Set<DocumentPath>();
    for (const entry of this.trackedBlocks.values()) {
      if (pathPrefix === undefined || matchesPrefix(entry.path, pathPrefix)) {
        paths.add(entry.path);
      }
    }
    for (const p of paths) yield p;
  }

  async *getDocumentBlocksRefs(
    pathPrefix?: DocumentPath,
  ): AsyncGenerator<BlockReference> {
    this.ensureOpen();
    for (const entry of this.trackedBlocks.values()) {
      if (pathPrefix === undefined || matchesPrefix(entry.path, pathPrefix)) {
        yield { path: entry.path, blockId: entry.blockId };
      }
    }
  }

  async *getDocumentsBlocks(
    pathPrefix?: DocumentPath,
  ): AsyncGenerator<IndexedBlock> {
    this.ensureOpen();
    for (const entry of this.trackedBlocks.values()) {
      if (pathPrefix !== undefined && !matchesPrefix(entry.path, pathPrefix)) {
        continue;
      }
      const block: IndexedBlock = {
        path: entry.path,
        blockId: entry.blockId,
      };
      // Retrieve content from FTS sub-index if available
      if (this.fts !== null) {
        for await (const ftsBlock of this.fts.getDocumentsBlocks()) {
          if (
            ftsBlock.path === entry.path &&
            ftsBlock.blockId === entry.blockId
          ) {
            block.content = ftsBlock.content;
            block.metadata = ftsBlock.metadata;
            break;
          }
        }
      }
      // Retrieve embedding from vec sub-index if available
      if (this.vec !== null) {
        for await (const vecBlock of this.vec.getDocumentsBlocks()) {
          if (
            vecBlock.path === entry.path &&
            vecBlock.blockId === entry.blockId
          ) {
            block.embedding = vecBlock.embedding;
            if (!block.metadata) block.metadata = vecBlock.metadata;
            break;
          }
        }
      }
      yield block;
    }
  }

  getFullTextIndex(): FullTextIndex | null {
    return this.fts;
  }

  getVectorIndex(): EmbeddingIndex | null {
    return this.vec;
  }

  async close(_options?: { force?: boolean }): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.fts !== null) await this.fts.close();
    if (this.vec !== null) await this.vec.close();
  }

  async flush(): Promise<void> {
    this.ensureOpen();
    if (this.fts !== null) await this.fts.flush();
    if (this.vec !== null) await this.vec.flush();
  }

  async deleteIndex(): Promise<void> {
    this.ensureOpen();
    if (this.fts !== null) await this.fts.deleteIndex();
    if (this.vec !== null) await this.vec.deleteIndex();
    this.trackedBlocks.clear();
    this.closed = true;
  }
}
