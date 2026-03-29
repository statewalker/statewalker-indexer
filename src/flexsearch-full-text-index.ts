import type {
  BlockReference,
  DocumentPath,
  FullTextBlock,
  FullTextIndex,
  FullTextIndexInfo,
  FullTextSearchParams,
  FullTextSearchResult,
  Metadata,
  PathSelector,
} from "@repo/indexer-api";
import FlexSearch from "flexsearch";

interface StoredBlock {
  path: DocumentPath;
  blockId: string;
  content: string;
  metadata?: Metadata;
}

function compositeKey(path: DocumentPath, blockId: string): string {
  return `${path}\0${blockId}`;
}

function matchesPrefix(path: DocumentPath, prefix: DocumentPath): boolean {
  return path.startsWith(prefix);
}

export class FlexSearchFullTextIndex implements FullTextIndex {
  private readonly info: FullTextIndexInfo;
  private flexIndex: FlexSearch.Index;
  private keyToNum = new Map<string, number>();
  private numToKey = new Map<number, string>();
  private blocks = new Map<string, StoredBlock>();
  private nextNum = 1;
  private closed = false;

  constructor(info: FullTextIndexInfo) {
    this.info = info;
    this.flexIndex = new FlexSearch.Index({
      tokenize: "forward",
      resolution: 9,
      cache: true,
    });
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("FullTextIndex is closed");
    }
  }

  private getOrAssignNum(key: string): number {
    let num = this.keyToNum.get(key);
    if (num === undefined) {
      num = this.nextNum++;
      this.keyToNum.set(key, num);
      this.numToKey.set(num, key);
    }
    return num;
  }

  private searchInternal(
    query: string,
    topK: number,
    pathPrefixes?: DocumentPath[],
  ): FullTextSearchResult[] {
    const ids = this.flexIndex.search(query, topK * 3) as number[];

    let results: Array<{ key: string; score: number }>;

    if (ids.length === 0) {
      // Word-fallback search
      const words = query.split(/\s+/).filter((w) => w.length > 1);
      const scores = new Map<number, number>();
      for (const word of words) {
        const wordIds = this.flexIndex.search(word, topK * 3) as number[];
        for (let i = 0; i < wordIds.length; i++) {
          const numId = wordIds[i];
          if (numId === undefined) continue;
          scores.set(numId, (scores.get(numId) ?? 0) + 1 - i / wordIds.length);
        }
      }
      results = [...scores.entries()]
        .map(([numId, score]) => ({
          key: this.numToKey.get(numId) ?? "",
          score,
        }))
        .filter((r) => r.key !== "");
    } else {
      results = ids
        .map((numId, rank) => ({
          key: this.numToKey.get(numId) ?? "",
          score: 1 - rank / ids.length,
        }))
        .filter((r) => r.key !== "");
    }

    // Filter by path prefixes
    if (pathPrefixes && pathPrefixes.length > 0) {
      results = results.filter((r) => {
        const block = this.blocks.get(r.key);
        return (
          block !== undefined &&
          pathPrefixes.some((p) => matchesPrefix(block.path, p))
        );
      });
    }

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK).map((r) => {
      const block = this.blocks.get(r.key);
      return {
        path: block?.path ?? ("/" as DocumentPath),
        blockId: block?.blockId ?? "",
        snippet: block?.content ?? "",
        score: r.score,
      };
    });
  }

  async getIndexInfo(): Promise<FullTextIndexInfo> {
    this.ensureOpen();
    return { ...this.info };
  }

  async *search(
    params: FullTextSearchParams,
  ): AsyncGenerator<FullTextSearchResult> {
    this.ensureOpen();
    const { queries, topK, paths } = params;

    if (!queries || queries.length === 0) return;

    // Multi-query: search for each, merge by best score
    const bestScores = new Map<string, FullTextSearchResult>();

    for (const query of queries) {
      const results = this.searchInternal(query, topK, paths);
      for (const r of results) {
        const key = compositeKey(r.path, r.blockId);
        const existing = bestScores.get(key);
        if (!existing || r.score > existing.score) {
          bestScores.set(key, r);
        }
      }
    }

    const sorted = [...bestScores.values()].sort((a, b) => b.score - a.score);
    for (const r of sorted.slice(0, topK)) {
      yield r;
    }
  }

  async addDocument(blocks: FullTextBlock[]): Promise<void> {
    this.ensureOpen();
    for (const block of blocks) {
      const key = compositeKey(block.path, block.blockId);
      const num = this.getOrAssignNum(key);
      // Remove old content if exists
      if (this.blocks.has(key)) {
        this.flexIndex.remove(num);
      }
      this.flexIndex.add(num, block.content);
      this.blocks.set(key, {
        path: block.path,
        blockId: block.blockId,
        content: block.content,
        metadata: block.metadata,
      });
    }
  }

  async addDocuments(
    blocks: Iterable<FullTextBlock[]> | AsyncIterable<FullTextBlock[]>,
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
    for await (const sel of pathSelectors as AsyncIterable<PathSelector>) {
      if (sel.blockId !== undefined) {
        const key = compositeKey(sel.path, sel.blockId);
        this.removeByKey(key);
      } else {
        const keysToDelete: string[] = [];
        for (const [key, block] of this.blocks) {
          if (matchesPrefix(block.path, sel.path)) {
            keysToDelete.push(key);
          }
        }
        for (const key of keysToDelete) {
          this.removeByKey(key);
        }
      }
    }
  }

  private removeByKey(key: string): void {
    const num = this.keyToNum.get(key);
    if (num !== undefined) {
      this.flexIndex.remove(num);
      this.keyToNum.delete(key);
      this.numToKey.delete(num);
    }
    this.blocks.delete(key);
  }

  async getSize(pathPrefix?: DocumentPath): Promise<number> {
    this.ensureOpen();
    if (pathPrefix === undefined) return this.blocks.size;
    let count = 0;
    for (const block of this.blocks.values()) {
      if (matchesPrefix(block.path, pathPrefix)) count++;
    }
    return count;
  }

  async *getDocumentPaths(
    pathPrefix?: DocumentPath,
  ): AsyncGenerator<DocumentPath> {
    this.ensureOpen();
    const paths = new Set<DocumentPath>();
    for (const block of this.blocks.values()) {
      if (pathPrefix === undefined || matchesPrefix(block.path, pathPrefix)) {
        paths.add(block.path);
      }
    }
    for (const p of paths) yield p;
  }

  async *getDocumentBlocksRefs(
    pathPrefix?: DocumentPath,
  ): AsyncGenerator<BlockReference> {
    this.ensureOpen();
    for (const block of this.blocks.values()) {
      if (pathPrefix === undefined || matchesPrefix(block.path, pathPrefix)) {
        yield { path: block.path, blockId: block.blockId };
      }
    }
  }

  async *getDocumentsBlocks(
    pathPrefix?: DocumentPath,
  ): AsyncGenerator<FullTextBlock> {
    this.ensureOpen();
    for (const block of this.blocks.values()) {
      if (pathPrefix === undefined || matchesPrefix(block.path, pathPrefix)) {
        yield {
          path: block.path,
          blockId: block.blockId,
          content: block.content,
          metadata: block.metadata,
        };
      }
    }
  }

  async close(_options?: { force?: boolean }): Promise<void> {
    this.closed = true;
  }

  async flush(): Promise<void> {
    this.ensureOpen();
    // no-op for in-memory
  }

  async deleteIndex(): Promise<void> {
    this.ensureOpen();
    this.blocks.clear();
    this.keyToNum.clear();
    this.numToKey.clear();
    this.closed = true;
  }

  /** Serialize to JSON string (v3 format with path data) */
  async serialize(): Promise<string> {
    const chunks = new Map<string, string>();
    await this.flexIndex.export((key: string | number, data: string) => {
      chunks.set(String(key), data);
    });

    const blocksData: Array<{
      path: string;
      blockId: string;
      content: string;
      metadata?: Metadata;
    }> = [];
    for (const block of this.blocks.values()) {
      blocksData.push({
        path: block.path,
        blockId: block.blockId,
        content: block.content,
        metadata: block.metadata,
      });
    }

    return JSON.stringify({
      version: 3,
      chunks: Object.fromEntries(chunks),
      blocks: blocksData,
      keyToNum: [...this.keyToNum.entries()],
      nextNum: this.nextNum,
    });
  }

  /** Deserialize from JSON — handles v3 format */
  static deserialize(
    info: FullTextIndexInfo,
    json: string,
  ): FlexSearchFullTextIndex {
    const parsed = JSON.parse(json) as {
      version?: number;
      chunks: Record<string, string>;
      blocks: Array<{
        path: string;
        blockId: string;
        content: string;
        metadata?: Metadata;
      }>;
      keyToNum: Array<[string, number]>;
      nextNum: number;
    };

    const fts = new FlexSearchFullTextIndex(info);

    if (parsed.version === 3) {
      for (const [key, data] of Object.entries(parsed.chunks)) {
        fts.flexIndex.import(key, data);
      }
      for (const [key, num] of parsed.keyToNum) {
        fts.keyToNum.set(key, num);
        fts.numToKey.set(num, key);
      }
      fts.nextNum = parsed.nextNum;
      for (const block of parsed.blocks) {
        const key = compositeKey(block.path as DocumentPath, block.blockId);
        fts.blocks.set(key, {
          path: block.path as DocumentPath,
          blockId: block.blockId,
          content: block.content,
          metadata: block.metadata,
        });
      }
    }

    return fts;
  }
}
