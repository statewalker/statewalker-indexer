import type {
  BlockReference,
  DocumentPath,
  Metadata,
  PathSelector,
  PersistableSearchIndex,
  PersistenceEntry,
} from "@statewalker/indexer-api";
import {
  compositeKey,
  matchesPrefix,
  readEntryBytes,
  singleChunk,
  toAsyncIterable,
  toBytes,
} from "@statewalker/indexer-core";
import type {
  FullTextBlock,
  FullTextIndex,
  FullTextIndexInfo,
  FulltextQuery as FullTextSearchParams,
  FulltextResult as FullTextSearchResult,
} from "@statewalker/indexer-fulltext";
import FlexSearch, { type Index as FlexIndex } from "flexsearch";

interface StoredBlock {
  path: DocumentPath;
  blockId: string;
  content: string;
  metadata?: Metadata;
}

export class FlexSearchFullTextIndex
  implements
    FullTextIndex,
    PersistableSearchIndex<FullTextBlock, FullTextSearchParams, FullTextSearchResult>
{
  private readonly info: FullTextIndexInfo;
  private flexIndex: FlexIndex;
  private keyToNum = new Map<string, number>();
  private numToKey = new Map<number, string>();
  private blocks = new Map<string, StoredBlock>();
  private nextNum = 1;
  private closed = false;
  /**
   * Dirty bit. `true` whenever the FTS index has been mutated since the
   * last `serialize()`. The serializer caches the last produced JSON and
   * returns it directly when `!dirty`, so a no-op re-sync skips the
   * expensive FlexSearch export entirely. Starts `true` so the first
   * serialize after construction always runs.
   */
  private dirty = true;
  private cachedSerialized?: string;

  constructor(info: FullTextIndexInfo) {
    this.info = info;
    this.flexIndex = new FlexSearch.Index({
      tokenize: "forward",
      resolution: 9,
      cache: true,
    });
  }

  /**
   * `true` when the in-memory state has changed since the last serialize.
   * Callers (e.g. the persistence layer) may use it to skip serialization
   * and writes when the index has not been touched.
   */
  isDirty(): boolean {
    return this.dirty;
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
        return block !== undefined && pathPrefixes.some((p) => matchesPrefix(block.path, p));
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

  async *search(params: FullTextSearchParams): AsyncGenerator<FullTextSearchResult> {
    this.ensureOpen();
    const { queries, paths } = params;
    const topK = params.topK ?? 100;

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
    if (blocks.length === 0) return;
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
    this.dirty = true;
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
    let removed = 0;
    for await (const sel of toAsyncIterable(pathSelectors)) {
      if (sel.blockId !== undefined) {
        const key = compositeKey(sel.path, sel.blockId);
        if (this.removeByKey(key)) removed += 1;
      } else {
        const keysToDelete: string[] = [];
        for (const [key, block] of this.blocks) {
          if (matchesPrefix(block.path, sel.path)) {
            keysToDelete.push(key);
          }
        }
        for (const key of keysToDelete) {
          if (this.removeByKey(key)) removed += 1;
        }
      }
    }
    if (removed > 0) this.dirty = true;
  }

  /** Returns true when the key was present and got removed. */
  private removeByKey(key: string): boolean {
    const num = this.keyToNum.get(key);
    const had = this.blocks.has(key);
    if (num !== undefined) {
      this.flexIndex.remove(num);
      this.keyToNum.delete(key);
      this.numToKey.delete(num);
    }
    this.blocks.delete(key);
    return had;
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
    // no-op for in-memory
  }

  async deleteIndex(): Promise<void> {
    this.ensureOpen();
    this.blocks.clear();
    this.keyToNum.clear();
    this.numToKey.clear();
    this.cachedSerialized = undefined;
    this.dirty = true;
    this.closed = true;
  }

  // --- PersistableSearchIndex --------------------------------------------------

  /**
   * Stream the FTS sub-index's state as a single named entry. The composite
   * prefixes this with `${indexName}/${subName}/` before it hits persistence.
   */
  async *serialise(): AsyncIterable<PersistenceEntry> {
    const json = await this.serialize();
    yield { name: "json", content: singleChunk(toBytes(json)) };
  }

  /** Restore the FTS sub-index from a previously-produced entry set. */
  async loadFrom(entries: Iterable<PersistenceEntry>): Promise<void> {
    this.ensureOpen();
    for (const e of entries) {
      if (e.name !== "json") continue;
      const bytes = await readEntryBytes(e);
      const json = new TextDecoder().decode(bytes);
      const rebuilt = FlexSearchFullTextIndex.deserialize(this.info, json);
      // Adopt the rebuilt instance's internal state.
      this.flexIndex = rebuilt.flexIndex;
      this.keyToNum = rebuilt.keyToNum;
      this.numToKey = rebuilt.numToKey;
      this.blocks = rebuilt.blocks;
      this.nextNum = rebuilt.nextNum;
      this.cachedSerialized = json;
      this.dirty = false;
      return;
    }
  }

  /**
   * Serialize to JSON string (v3 format with path data).
   *
   * Caches the result; while `dirty` is false (no mutations since the
   * last call) returns the same string, skipping the FlexSearch export
   * entirely. The persistence layer still calls into us each flush, but
   * the heavy work only runs when the index actually changed.
   */
  async serialize(): Promise<string> {
    if (!this.dirty && this.cachedSerialized !== undefined) {
      return this.cachedSerialized;
    }
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

    const out = JSON.stringify({
      version: 3,
      chunks: Object.fromEntries(chunks),
      blocks: blocksData,
      keyToNum: [...this.keyToNum.entries()],
      nextNum: this.nextNum,
    });
    this.cachedSerialized = out;
    this.dirty = false;
    return out;
  }

  /** Deserialize from JSON — handles v3 format */
  static deserialize(info: FullTextIndexInfo, json: string): FlexSearchFullTextIndex {
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

    if (parsed.version !== 3) {
      throw new Error(
        `FlexSearchFullTextIndex: unsupported serialised version ${String(parsed.version)} (expected 3)`,
      );
    }

    const fts = new FlexSearchFullTextIndex(info);
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
    // Prime the cache: a deserialized index that's never mutated should
    // return the same JSON it was loaded from when re-serialized.
    fts.cachedSerialized = json;
    fts.dirty = false;
    return fts;
  }
}
