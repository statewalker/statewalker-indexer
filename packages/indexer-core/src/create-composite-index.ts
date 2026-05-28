import type {
  AnySubIndexBinding,
  Index,
  Metadata,
  PathSelector,
  ScoredHit,
  SearchRequest,
  SearchResult,
} from "@statewalker/indexer-api";
import { setSubResult } from "@statewalker/indexer-api";
import { toAsyncIterable } from "./async.js";
import { compositeKey } from "./composite-key.js";
import { type RankedList, reciprocalRankFusion } from "./rrf.js";

/**
 * Options for {@link createCompositeIndex}.
 *
 * Modality-agnostic: the composite accepts a set of {@link AnySubIndexBinding}s
 * and fans out generically by **sub-index name**. Backends register bindings —
 * each is the slim `{ name, type, config, index }` 4-tuple — and may pass an
 * `onAfterDelete` / `onDeleteIndex` hook to reclaim shared rows.
 */
export interface CompositeIndexOptions {
  name: string;
  metadata?: Metadata;
  /** Initial bindings; more may be added later via `setBinding`. */
  bindings?: AnySubIndexBinding[];
  /** Hook invoked after every binding's `deleteDocuments` returns. */
  onAfterDelete?: () => Promise<void>;
  /** Hook invoked after every binding's `deleteIndex` returns. */
  onDeleteIndex?: () => Promise<void>;
}

/**
 * Engine-agnostic composite {@link Index}: an open registry of named sub-index
 * bindings that fan out lifecycle and blend search results by RRF.
 *
 * `Index.search` iterates registered bindings and runs each binding whose
 * **name** appears in `request.subQueries`, then fuses the ranked streams via
 * {@link reciprocalRankFusion}. The top-level `score` is always the RRF fusion
 * score; modality-native magnitudes survive on each binding's sub-result
 * (attached under `binding.name` in `result.subResults`).
 */
export function createCompositeIndex(opts: CompositeIndexOptions): Index {
  const { name, metadata, onAfterDelete, onDeleteIndex } = opts;
  const bindings = new Map<string, AnySubIndexBinding>();
  for (const b of opts.bindings ?? []) bindings.set(b.name, b);
  let closed = false;

  const ensureOpen = (): void => {
    if (closed) throw new Error(`Index "${name}" is closed`);
  };

  return {
    name,
    metadata,

    // --- Registry ------------------------------------------------------------

    setBinding(binding: AnySubIndexBinding): void {
      bindings.set(binding.name, binding);
    },
    getBinding(key: string): AnySubIndexBinding | undefined {
      return bindings.get(key);
    },
    getBindings(): Iterable<AnySubIndexBinding> {
      return bindings.values();
    },

    // --- Search --------------------------------------------------------------

    async *search(request: SearchRequest): AsyncGenerator<SearchResult> {
      ensureOpen();

      // Active = registered ∧ name present in request.subQueries. Each active
      // binding contributes one ranked stream, in registration order.
      type Active = {
        binding: AnySubIndexBinding;
        hits: Map<string, ScoredHit>;
        order: string[]; // compositeKey order = retrieval rank
        ids: Map<string, { path: SearchResult["path"]; blockId: string }>;
      };

      const subQueries = request.subQueries;
      if (!subQueries) return;

      const active: Active[] = [];
      for (const binding of bindings.values()) {
        const q = subQueries[binding.name];
        if (q === undefined) continue;
        const hits = new Map<string, ScoredHit>();
        const order: string[] = [];
        const ids = new Map<string, { path: SearchResult["path"]; blockId: string }>();
        // Sub-index's `search` is typed Q→R; we erased through unknown via the
        // existential binding shape — the runtime invariant is that the
        // sub-query under this name matches the sub-index's expected shape.
        for await (const hit of binding.index.search(q)) {
          const ck = compositeKey(hit.path, hit.blockId);
          if (!hits.has(ck)) {
            hits.set(ck, hit);
            ids.set(ck, { path: hit.path, blockId: hit.blockId });
            order.push(ck);
          }
        }
        active.push({ binding, hits, order, ids });
      }

      if (active.length === 0) return;

      const lists: RankedList[] = active.map((a) => ({
        results: a.order.map((ck) => ({ blockId: ck, score: a.hits.get(ck)?.score ?? 0 })),
        meta: { source: a.binding.name, queryType: a.binding.type, query: "" },
      }));

      const fused = reciprocalRankFusion(lists, request.topK);

      for (const item of fused) {
        const ck = item.blockId;
        let pathBlockId: { path: SearchResult["path"]; blockId: string } | undefined;
        for (const a of active) {
          const ids = a.ids.get(ck);
          if (ids) {
            pathBlockId = ids;
            break;
          }
        }
        if (!pathBlockId) continue;
        const result: SearchResult = {
          path: pathBlockId.path,
          blockId: pathBlockId.blockId,
          score: item.score,
        };
        for (const a of active) {
          const hit = a.hits.get(ck);
          if (hit) setSubResult(result, a.binding.name, hit);
        }
        yield result;
      }
    },

    // --- Lifecycle -----------------------------------------------------------

    async deleteDocuments(
      pathSelectors: PathSelector[] | AsyncIterable<PathSelector>,
    ): Promise<void> {
      ensureOpen();
      const selectors: PathSelector[] = [];
      for await (const sel of toAsyncIterable(pathSelectors)) selectors.push(sel);
      for (const b of bindings.values()) await b.index.deleteDocuments(selectors);
      if (onAfterDelete) await onAfterDelete();
    },

    async flush(): Promise<void> {
      ensureOpen();
      for (const b of bindings.values()) await b.index.flush();
    },

    async close(options?: { force?: boolean }): Promise<void> {
      if (closed) return;
      closed = true;
      for (const b of bindings.values()) await b.index.close(options);
    },

    async deleteIndex(): Promise<void> {
      ensureOpen();
      for (const b of bindings.values()) await b.index.deleteIndex();
      if (onDeleteIndex) await onDeleteIndex();
      closed = true;
    },
  };
}
