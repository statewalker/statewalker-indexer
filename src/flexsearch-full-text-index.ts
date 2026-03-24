import type {
  BlockId,
  FullTextIndex,
  FullTextIndexInfo,
  Metadata,
  SearchResult,
} from "@repo/indexer-api";
import FlexSearch from "flexsearch";

export class FlexSearchFullTextIndex implements FullTextIndex {
  private readonly info: FullTextIndexInfo;
  private readonly flexIndex: FlexSearch.Index;
  /** Maps string blockId to internal numeric id for FlexSearch */
  private blockIdToNum = new Map<string, number>();
  /** Maps internal numeric id back to string blockId */
  private numToBlockId = new Map<number, string>();
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

  private getOrAssignNum(blockId: BlockId): number {
    let num = this.blockIdToNum.get(blockId);
    if (num === undefined) {
      num = this.nextNum++;
      this.blockIdToNum.set(blockId, num);
      this.numToBlockId.set(num, blockId);
    }
    return num;
  }

  async getIndexInfo(): Promise<FullTextIndexInfo> {
    this.ensureOpen();
    return { ...this.info };
  }

  async deleteIndex(): Promise<void> {
    this.ensureOpen();
    this.closed = true;
    this.blockIdToNum.clear();
    this.numToBlockId.clear();
  }

  async search(params: {
    query: string;
    topK: number;
  }): Promise<SearchResult[]> {
    this.ensureOpen();

    // Try the full query first (AND matching)
    const ids = this.flexIndex.search(params.query, params.topK) as number[];

    // If no results, search individual words and merge (OR matching)
    if (ids.length === 0) {
      const words = params.query.split(/\s+/).filter((w) => w.length > 1);
      const scores = new Map<number, number>();
      for (const word of words) {
        const wordIds = this.flexIndex.search(word, params.topK) as number[];
        for (let i = 0; i < wordIds.length; i++) {
          const numId = wordIds[i]!;
          scores.set(numId, (scores.get(numId) ?? 0) + 1 - i / wordIds.length);
        }
      }
      const sorted = [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, params.topK);
      return sorted.map(([numId, score]) => ({
        blockId: this.numToBlockId.get(numId) ?? String(numId),
        score,
      }));
    }

    return ids.map((numId, rank) => ({
      blockId: this.numToBlockId.get(numId) ?? String(numId),
      score: 1 - rank / ids.length,
    }));
  }

  async addDocument(params: {
    blockId: BlockId;
    content: string;
    metadata?: Metadata;
  }): Promise<void> {
    this.ensureOpen();
    const num = this.getOrAssignNum(params.blockId);
    if (this.blockIdToNum.has(params.blockId)) {
      this.flexIndex.remove(num);
    }
    this.flexIndex.add(num, params.content);
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
    const num = this.blockIdToNum.get(blockId);
    if (num !== undefined) {
      this.flexIndex.remove(num);
      this.blockIdToNum.delete(blockId);
      this.numToBlockId.delete(num);
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
    return this.blockIdToNum.has(blockId);
  }

  async getSize(): Promise<number> {
    this.ensureOpen();
    return this.blockIdToNum.size;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Export FlexSearch native chunks as key/value pairs */
  async exportChunks(): Promise<Map<string, string>> {
    const chunks = new Map<string, string>();
    await this.flexIndex.export((key: string | number, data: string) => {
      chunks.set(String(key), data);
    });
    return chunks;
  }

  /** Serialize to JSON string using native FlexSearch export */
  async serialize(): Promise<string> {
    const chunks = await this.exportChunks();
    const mapping = [...this.blockIdToNum.entries()];
    return JSON.stringify({
      chunks: Object.fromEntries(chunks),
      blockIds: mapping,
      nextNum: this.nextNum,
    });
  }

  /** Import FlexSearch native chunks and restore blockId mapping */
  static importChunks(
    info: FullTextIndexInfo,
    chunks: Map<string, string>,
    blockIdMapping: Array<[string, number]>,
    nextNum: number,
  ): FlexSearchFullTextIndex {
    const fts = new FlexSearchFullTextIndex(info);
    for (const [key, data] of chunks) {
      fts.flexIndex.import(key, data);
    }
    for (const [blockId, num] of blockIdMapping) {
      fts.blockIdToNum.set(blockId, num);
      fts.numToBlockId.set(num, blockId);
    }
    fts.nextNum = nextNum;
    return fts;
  }

  /** Deserialize from JSON string produced by serialize() */
  static deserialize(
    info: FullTextIndexInfo,
    json: string,
  ): FlexSearchFullTextIndex {
    const parsed = JSON.parse(json) as {
      chunks: Record<string, string>;
      blockIds: Array<[string, number]>;
      nextNum: number;
    };
    const chunks = new Map(Object.entries(parsed.chunks));
    return FlexSearchFullTextIndex.importChunks(
      info,
      chunks,
      parsed.blockIds,
      parsed.nextNum,
    );
  }
}
