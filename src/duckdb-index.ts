import type { Db } from "@repo/db";
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
import type { DuckDbFullTextIndex } from "./duckdb-full-text-index.js";
import type { DuckDbVectorIndex } from "./duckdb-vector-index.js";
import { mergeByRRF, mergeByWeights } from "./hybrid-search.js";

export class DuckDbIndex implements Index {
  readonly name: string;
  readonly metadata?: Metadata;
  private readonly db: Db;
  private readonly docsTable: string;
  private readonly fts: DuckDbFullTextIndex | null;
  private readonly vec: DuckDbVectorIndex | null;
  private closed = false;

  constructor(
    name: string,
    db: Db,
    docsTable: string,
    fts: DuckDbFullTextIndex | null,
    vec: DuckDbVectorIndex | null,
    metadata?: Metadata,
  ) {
    this.name = name;
    this.db = db;
    this.docsTable = docsTable;
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

    const ftsResults = [];
    if (hasQueries) {
      for await (const r of this.fts.search({ queries, topK, paths })) {
        ftsResults.push(r);
      }
    }

    const vecResults = [];
    if (hasEmbeddings) {
      for await (const r of this.vec.search({ embeddings, topK, paths })) {
        vecResults.push(r);
      }
    }

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
    if (this.fts !== null) await this.fts.deleteDocuments(selectors);
    if (this.vec !== null) await this.vec.deleteDocuments(selectors);
  }

  async getSize(pathPrefix?: DocumentPath): Promise<number> {
    this.ensureOpen();
    // Count unique (path, blockId) pairs across both sub-indexes
    const hasFts = this.fts !== null;
    const hasVec = this.vec !== null;

    if (hasFts && hasVec) {
      const pathClause =
        pathPrefix !== undefined ? ` WHERE d.path LIKE $1 || '%'` : "";
      const params = pathPrefix !== undefined ? [pathPrefix] : [];
      const ftsTable = (this.fts as DuckDbFullTextIndex).tableName;
      const vecTable = (this.vec as DuckDbVectorIndex).tableName;
      const sql = `SELECT COUNT(*) AS cnt FROM (SELECT b.doc_id, b.block_id FROM ${ftsTable} b JOIN ${this.docsTable} d ON d.doc_id = b.doc_id${pathClause} UNION SELECT b.doc_id, b.block_id FROM ${vecTable} b JOIN ${this.docsTable} d ON d.doc_id = b.doc_id${pathClause})`;
      const rows = await this.db.query<{ cnt: number | bigint }>(sql, params);
      return Number(rows[0]?.cnt ?? 0);
    }

    if (hasFts) return this.fts.getSize(pathPrefix);
    if (hasVec) return this.vec.getSize(pathPrefix);
    return 0;
  }

  async *getDocumentPaths(
    pathPrefix?: DocumentPath,
  ): AsyncGenerator<DocumentPath> {
    this.ensureOpen();
    const paths = new Set<string>();
    if (this.fts) {
      for await (const p of this.fts.getDocumentPaths(pathPrefix)) {
        paths.add(p);
      }
    }
    if (this.vec) {
      for await (const p of this.vec.getDocumentPaths(pathPrefix)) {
        paths.add(p);
      }
    }
    for (const p of paths) {
      yield p as DocumentPath;
    }
  }

  async *getDocumentBlocksRefs(
    pathPrefix?: DocumentPath,
  ): AsyncGenerator<BlockReference> {
    this.ensureOpen();
    const seen = new Set<string>();
    if (this.fts) {
      for await (const ref of this.fts.getDocumentBlocksRefs(pathPrefix)) {
        const key = `${ref.path}\0${ref.blockId}`;
        seen.add(key);
        yield ref;
      }
    }
    if (this.vec) {
      for await (const ref of this.vec.getDocumentBlocksRefs(pathPrefix)) {
        const key = `${ref.path}\0${ref.blockId}`;
        if (!seen.has(key)) {
          yield ref;
        }
      }
    }
  }

  async *getDocumentsBlocks(
    pathPrefix?: DocumentPath,
  ): AsyncGenerator<IndexedBlock> {
    this.ensureOpen();
    // Merge blocks from both sub-indexes
    const blockMap = new Map<string, IndexedBlock>();

    if (this.fts) {
      for await (const b of this.fts.getDocumentsBlocks(pathPrefix)) {
        const key = `${b.path}\0${b.blockId}`;
        blockMap.set(key, {
          path: b.path,
          blockId: b.blockId,
          content: b.content,
          metadata: b.metadata,
        });
      }
    }
    if (this.vec) {
      for await (const b of this.vec.getDocumentsBlocks(pathPrefix)) {
        const key = `${b.path}\0${b.blockId}`;
        const existing = blockMap.get(key);
        if (existing) {
          existing.embedding = b.embedding;
        } else {
          blockMap.set(key, {
            path: b.path,
            blockId: b.blockId,
            embedding: b.embedding,
          });
        }
      }
    }

    for (const block of blockMap.values()) {
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
  }

  async deleteIndex(): Promise<void> {
    this.ensureOpen();
    if (this.fts !== null) await this.fts.deleteIndex();
    if (this.vec !== null) await this.vec.deleteIndex();
    await this.db.exec(`DROP TABLE IF EXISTS ${this.docsTable}`);
    this.closed = true;
  }
}
