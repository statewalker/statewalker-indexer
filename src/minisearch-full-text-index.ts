import type {
  BlockId,
  FullTextIndex,
  FullTextIndexInfo,
  Metadata,
  SearchResult,
} from "@repo/indexer-api";
import MiniSearch from "minisearch";

export class MiniSearchFullTextIndex implements FullTextIndex {
  private readonly info: FullTextIndexInfo;
  private miniSearch: MiniSearch;
  private blockIds: Set<string> = new Set();
  private closed = false;

  constructor(info: FullTextIndexInfo) {
    this.info = info;
    this.miniSearch = new MiniSearch({
      fields: ["content"],
      idField: "blockId",
    });
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("FullTextIndex is closed");
    }
  }

  async getIndexInfo(): Promise<FullTextIndexInfo> {
    this.ensureOpen();
    return { ...this.info };
  }

  async deleteIndex(): Promise<void> {
    this.ensureOpen();
    this.closed = true;
    this.blockIds.clear();
  }

  async search(params: {
    query: string;
    topK: number;
  }): Promise<SearchResult[]> {
    this.ensureOpen();

    // Try with prefix and fuzzy matching first
    let results = this.miniSearch.search(params.query, {
      prefix: true,
      fuzzy: 0.2,
    });

    // If no results, try exact match without fuzzy
    if (results.length === 0) {
      results = this.miniSearch.search(params.query, {
        prefix: true,
      });
    }

    // If still no results, try individual words (OR matching)
    if (results.length === 0) {
      const words = params.query.split(/\s+/).filter((w) => w.length > 1);
      if (words.length > 1) {
        results = this.miniSearch.search(params.query, {
          prefix: true,
          fuzzy: 0.2,
          combineWith: "OR",
        });
      }
    }

    return results.slice(0, params.topK).map((r) => ({
      blockId: r.id as BlockId,
      score: r.score,
    }));
  }

  async addDocument(params: {
    blockId: BlockId;
    content: string;
    metadata?: Metadata;
  }): Promise<void> {
    this.ensureOpen();
    if (this.blockIds.has(params.blockId)) {
      this.miniSearch.discard(params.blockId);
    }
    this.miniSearch.add({ blockId: params.blockId, content: params.content });
    this.blockIds.add(params.blockId);
  }

  async addDocuments(
    docs:
      | Iterable<{ blockId: BlockId; content: string; metadata?: Metadata }>
      | AsyncIterable<{
          blockId: BlockId;
          content: string;
          metadata?: Metadata;
        }>,
  ): Promise<void> {
    this.ensureOpen();
    for await (const doc of docs as AsyncIterable<{
      blockId: BlockId;
      content: string;
      metadata?: Metadata;
    }>) {
      await this.addDocument(doc);
    }
  }

  async deleteDocument(blockId: BlockId): Promise<void> {
    this.ensureOpen();
    if (this.blockIds.has(blockId)) {
      this.miniSearch.discard(blockId);
      this.blockIds.delete(blockId);
    }
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
    return this.blockIds.has(blockId);
  }

  async getSize(): Promise<number> {
    this.ensureOpen();
    return this.blockIds.size;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Serialize using MiniSearch native toJSON */
  serialize(): string {
    return JSON.stringify({
      miniSearch: this.miniSearch.toJSON(),
      blockIds: [...this.blockIds],
    });
  }

  /** Deserialize using MiniSearch native loadJSON */
  static deserialize(
    info: FullTextIndexInfo,
    json: string,
  ): MiniSearchFullTextIndex {
    const parsed = JSON.parse(json) as {
      miniSearch: unknown;
      blockIds: string[];
    };
    const index = new MiniSearchFullTextIndex(info);
    index.miniSearch = MiniSearch.loadJSON(JSON.stringify(parsed.miniSearch), {
      fields: ["content"],
      idField: "blockId",
    });
    index.blockIds = new Set(parsed.blockIds);
    return index;
  }
}
