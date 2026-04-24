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
} from "@statewalker/indexer-api";
import { compositeKey, matchesPrefix, toAsyncIterable } from "@statewalker/indexer-core";
import MiniSearch from "minisearch";

interface StoredBlock {
  path: DocumentPath;
  blockId: string;
  content: string;
  metadata?: Metadata;
}

export class MiniSearchFullTextIndex implements FullTextIndex {
  private readonly info: FullTextIndexInfo;
  private miniSearch: MiniSearch;
  private blocks = new Map<string, StoredBlock>();
  private keySet = new Set<string>();
  private closed = false;

  constructor(info: FullTextIndexInfo) {
    this.info = info;
    this.miniSearch = new MiniSearch({
      fields: ["content"],
      idField: "key",
    });
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("FullTextIndex is closed");
    }
  }

  private searchInternal(
    query: string,
    topK: number,
    pathPrefixes?: DocumentPath[],
  ): FullTextSearchResult[] {
    let results = this.miniSearch.search(query, {
      prefix: true,
      fuzzy: 0.2,
    });

    if (results.length === 0) {
      results = this.miniSearch.search(query, { prefix: true });
    }

    if (results.length === 0) {
      const words = query.split(/\s+/).filter((w) => w.length > 1);
      if (words.length > 1) {
        results = this.miniSearch.search(query, {
          prefix: true,
          fuzzy: 0.2,
          combineWith: "OR",
        });
      }
    }

    // Filter by path prefixes
    let filtered = results.map((r) => ({
      key: r.id as string,
      score: r.score,
    }));

    if (pathPrefixes && pathPrefixes.length > 0) {
      filtered = filtered.filter((r) => {
        const block = this.blocks.get(r.key);
        return block !== undefined && pathPrefixes.some((p) => matchesPrefix(block.path, p));
      });
    }

    return filtered.slice(0, topK).map((r) => {
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

  async *search(params: FullTextSearchParams): AsyncGenerator<FullTextSearchResult> {
    this.ensureOpen();
    const { queries, topK, paths } = params;

    if (!queries || queries.length === 0) return;

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
      if (this.keySet.has(key)) {
        this.miniSearch.discard(key);
      }
      this.miniSearch.add({ key, content: block.content });
      this.keySet.add(key);
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
    for await (const sel of toAsyncIterable(pathSelectors)) {
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
    if (this.keySet.has(key)) {
      this.miniSearch.discard(key);
      this.keySet.delete(key);
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

  async *getDocumentPaths(pathPrefix?: DocumentPath): AsyncGenerator<DocumentPath> {
    this.ensureOpen();
    const paths = new Set<DocumentPath>();
    for (const block of this.blocks.values()) {
      if (pathPrefix === undefined || matchesPrefix(block.path, pathPrefix)) {
        paths.add(block.path);
      }
    }
    for (const p of paths) yield p;
  }

  async *getDocumentBlocksRefs(pathPrefix?: DocumentPath): AsyncGenerator<BlockReference> {
    this.ensureOpen();
    for (const block of this.blocks.values()) {
      if (pathPrefix === undefined || matchesPrefix(block.path, pathPrefix)) {
        yield { path: block.path, blockId: block.blockId };
      }
    }
  }

  async *getDocumentsBlocks(pathPrefix?: DocumentPath): AsyncGenerator<FullTextBlock> {
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
  }

  async deleteIndex(): Promise<void> {
    this.ensureOpen();
    this.blocks.clear();
    this.keySet.clear();
    this.closed = true;
  }

  /** Serialize to JSON (v3 format with path data) */
  serialize(): string {
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
      miniSearch: this.miniSearch.toJSON(),
      blocks: blocksData,
      keys: [...this.keySet],
    });
  }

  /** Deserialize from JSON — handles v3 format */
  static deserialize(info: FullTextIndexInfo, json: string): MiniSearchFullTextIndex {
    const parsed = JSON.parse(json) as {
      version?: number;
      miniSearch: unknown;
      blocks: Array<{
        path: string;
        blockId: string;
        content: string;
        metadata?: Metadata;
      }>;
      keys: string[];
    };

    const index = new MiniSearchFullTextIndex(info);

    if (parsed.version === 3) {
      index.miniSearch = MiniSearch.loadJSON(JSON.stringify(parsed.miniSearch), {
        fields: ["content"],
        idField: "key",
      });
      index.keySet = new Set(parsed.keys);
      for (const block of parsed.blocks) {
        const key = compositeKey(block.path as DocumentPath, block.blockId);
        index.blocks.set(key, {
          path: block.path as DocumentPath,
          blockId: block.blockId,
          content: block.content,
          metadata: block.metadata,
        });
      }
    }

    return index;
  }
}
