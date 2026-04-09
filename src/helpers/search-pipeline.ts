import type {
  DocumentPath,
  HybridSearchResult,
  HybridWeights,
  Index,
} from "../indexer-index.js";
import type { BlendTier } from "../reranker-blend.js";
import { blendWithReranker } from "../reranker-blend.js";
import type { EmbedFn } from "../semantic-index.js";
import type {
  Citation,
  CitationBuilderFn,
  ExpandedQuery,
  QueryExpanderFn,
  RerankerFn,
} from "./types.js";

export interface PipelineConfig {
  index: Index;
  embedFn?: EmbedFn;
  expander?: QueryExpanderFn;
  reranker?: RerankerFn;
  citationBuilder?: CitationBuilderFn;
  blendTiers?: BlendTier[];
}

export interface EntryExplain {
  expandedQueries: ExpandedQuery[];
  retrievalScore: number;
  rerankScore?: number;
  blendedScore: number;
}

export interface PipelineEntry {
  blockId: string;
  path: DocumentPath;
  score: number;
  citation?: Citation;
  explain?: EntryExplain;
}

type SkipStage = "expansion" | "rerank" | "citations";

export class SearchPipeline {
  private readonly config: PipelineConfig;
  private _paths?: DocumentPath[];
  private _prompt?: string;
  private _textQueries: string[] = [];
  private _semanticQueries: string[] = [];
  private _embeddings: Float32Array[] = [];
  private _topK = 10;
  private _weights?: HybridWeights;
  private _explain = false;
  private _reranker?: RerankerFn;
  private readonly _skip = new Set<SkipStage>();

  constructor(config: PipelineConfig) {
    this.config = config;
  }

  setPaths(...paths: DocumentPath[]): this {
    this._paths = paths;
    return this;
  }

  setPrompt(prompt: string): this {
    this._prompt = prompt;
    return this;
  }

  setTextQueries(...queries: string[]): this {
    this._textQueries = queries;
    return this;
  }

  setSemanticQueries(...queries: string[]): this {
    this._semanticQueries = queries;
    return this;
  }

  setEmbeddings(...embeddings: Float32Array[]): this {
    this._embeddings = embeddings;
    return this;
  }

  setTopK(topK: number): this {
    this._topK = topK;
    return this;
  }

  setWeights(weights: HybridWeights): this {
    this._weights = weights;
    return this;
  }

  setExplain(explain: boolean): this {
    this._explain = explain;
    return this;
  }

  setReranker(reranker: RerankerFn): this {
    this._reranker = reranker;
    return this;
  }

  skip(stage: SkipStage): this {
    this._skip.add(stage);
    return this;
  }

  async execute(): Promise<PipelineEntry[]> {
    const { index, embedFn, blendTiers } = this.config;
    const expander = !this._skip.has("expansion")
      ? this.config.expander
      : undefined;
    const reranker = !this._skip.has("rerank")
      ? (this._reranker ?? this.config.reranker)
      : undefined;
    const citationBuilder = !this._skip.has("citations")
      ? this.config.citationBuilder
      : undefined;

    // 1. EXPAND — resolve prompt into typed queries
    let expandedQueries: ExpandedQuery[] = [];
    const lexQueries: string[] = [...this._textQueries];
    const vecQueries: string[] = [...this._semanticQueries];
    const precomputedEmbeddings: Float32Array[] = [...this._embeddings];

    if (this._prompt) {
      if (expander) {
        try {
          expandedQueries = await expander(this._prompt);
          for (const eq of expandedQueries) {
            if (eq.type === "lex") {
              lexQueries.push(eq.query);
            } else {
              vecQueries.push(eq.query);
            }
          }
        } catch {
          lexQueries.push(this._prompt);
          if (embedFn) {
            vecQueries.push(this._prompt);
          }
        }
      } else {
        lexQueries.push(this._prompt);
        if (embedFn) {
          vecQueries.push(this._prompt);
        }
      }
    }

    if (
      lexQueries.length === 0 &&
      vecQueries.length === 0 &&
      precomputedEmbeddings.length === 0
    ) {
      throw new Error(
        "No queries, embeddings, or prompt provided to SearchPipeline",
      );
    }

    if (vecQueries.length > 0 && !embedFn) {
      throw new Error(
        "Semantic queries provided but no embedFn in pipeline config",
      );
    }

    // 2. EMBED semantic queries
    const embeddedVecs: Float32Array[] = [...precomputedEmbeddings];
    if (embedFn && vecQueries.length > 0) {
      const embedded = await Promise.all(vecQueries.map((q) => embedFn(q)));
      embeddedVecs.push(...embedded);
    }

    // 3. SEARCH — single call, delegate multi-query fusion to the index
    const results: HybridSearchResult[] = [];
    for await (const r of index.search({
      queries: lexQueries.length > 0 ? lexQueries : undefined,
      embeddings: embeddedVecs.length > 0 ? embeddedVecs : undefined,
      topK: this._topK,
      weights: this._weights,
      paths: this._paths,
    })) {
      results.push(r);
    }

    let entries: PipelineEntry[] = results.map((r) => ({
      blockId: r.blockId,
      path: r.path,
      score: r.score,
      ...(this._explain
        ? {
            explain: {
              expandedQueries,
              retrievalScore: r.score,
              blendedScore: r.score,
            },
          }
        : {}),
    }));

    // 4. RERANK
    if (reranker && entries.length > 0) {
      const queryForRerank =
        this._prompt ?? lexQueries[0] ?? vecQueries[0] ?? "";
      try {
        const candidates = entries.map((e) => ({
          blockId: e.blockId,
          text: e.blockId,
        }));
        const rerankResults = await reranker(queryForRerank, candidates);
        const rerankScores = new Map(
          rerankResults.map((r) => [r.blockId, r.score]),
        );
        const blended = blendWithReranker(entries, rerankScores, blendTiers);
        entries = blended.map((r) => {
          const existing = entries.find((e) => e.blockId === r.blockId);
          return {
            blockId: r.blockId,
            path: existing?.path ?? ("/" as DocumentPath),
            score: r.score,
            ...(this._explain && existing?.explain
              ? {
                  explain: {
                    ...existing.explain,
                    rerankScore: rerankScores.get(r.blockId),
                    blendedScore: r.score,
                  },
                }
              : {}),
          };
        });
      } catch {
        // Reranker failure — return retrieval results without blending
      }
    }

    // 5. CITE
    if (citationBuilder && !this._skip.has("citations") && entries.length > 0) {
      const queryForCite = this._prompt ?? lexQueries[0] ?? vecQueries[0] ?? "";
      try {
        const citations = await citationBuilder(
          queryForCite,
          entries,
          async (blockId) => blockId,
        );
        const citationMap = new Map(citations.map((c) => [c.blockId, c]));
        for (const entry of entries) {
          const cit = citationMap.get(entry.blockId);
          if (cit) {
            entry.citation = cit;
          }
        }
      } catch {
        // Citation failure — continue without citations
      }
    }

    return entries.slice(0, this._topK);
  }
}
