# @statewalker/indexer-search

Application-side search-orchestration stack built on [`@statewalker/indexer-api`](../indexer-api/README.md). Owns the strategy code that consumers of any conforming backend (`indexer-mem-*`, `indexer-pglite`, `indexer-duckdb`, …) typically want without re-implementing it themselves.

## What's in here

| Module | Purpose |
|--------|---------|
| `SearchPipeline` | Builder/executor for multi-stage search (expand → embed → search → rerank → cite) |
| `SemanticIndex`  | Convenience wrapper that auto-embeds at ingestion and search time |
| `parseStructuredQuery` / `validateLexQuery` / `validateSemanticQuery` | Parser for typed (`lex:` / `vec:` / `hyde:` / `expand:`) query syntax |
| `extractIntentTerms` / `selectBestChunk` | Intent-based stop-word filtering and chunk selection |
| `blendWithReranker` / `BlendTier` / `DEFAULT_BLEND_TIERS` | Position-aware reranker blending |
| Function types: `QueryExpanderFn`, `RerankerFn`, `CitationBuilderFn`, `ExpandedQuery`, `Citation` | The shapes a host application plugs in |
| `createMockExpander` / `createMockReranker` / `createMockCitationBuilder` | Deterministic test doubles for the function types |

The package depends on `@statewalker/indexer-api` only. It does not depend on `@statewalker/indexer-core` or any backend package — strategy code lives strictly above the contract layer.

## Why this lives in its own package

Backends should not pay the compile/type cost of strategy code they never call. Conversely, application code that needs a `SearchPipeline` should not be coupled to a specific backend. Splitting the contract (`indexer-api`) from the strategy stack (`indexer-search`) makes the layering explicit:

```
indexer-api          (contract: types + interfaces, zero runtime)
   ↑
indexer-core         (backend toolkit: fanOutSearch, RRF, mergeHybrid, …)
   ↑                            ↑
indexer-mem-*        indexer-search   (app-side: SearchPipeline, SemanticIndex, …)
indexer-pglite                           ↑
indexer-duckdb                    downstream apps
```

## How to use

### SemanticIndex — automatic embedding

```ts
import type { EmbedFn } from "@statewalker/indexer-api";
import { SemanticIndex } from "@statewalker/indexer-search";

const semantic = new SemanticIndex(index, embed satisfies EmbedFn);

// Embedding computed automatically from content
await semantic.addDocument({
  path: "/docs/guide/",
  blockId: "ch1",
  content: "Chapter 1: Introduction...",
});

// Search with automatic query embedding
const results = await semantic.search({
  query: "introduction",
  topK: 5,
});
```

### SearchPipeline — multi-stage search

`SearchPipeline` chains: **expand** (query expansion) → **embed** (semantic query embedding) → **search** (single `index.search()` call, delegating fusion to the index) → **rerank** (score blending) → **cite** (citation extraction). Each LLM stage is defined as a function type — pass closures, no class instantiation required.

```ts
import { SearchPipeline } from "@statewalker/indexer-search";

const results = await new SearchPipeline({
  index,
  embedFn: embed,
  expander: async (query) => [
    { type: "lex", query },
    { type: "vec", query: `semantic: ${query}` },
  ],
  reranker: async (query, candidates) =>
    candidates.map((c, i) => ({ blockId: c.blockId, score: 1 / (i + 1) })),
})
  .setPrompt("distributed consensus")
  .setTopK(10)
  .execute();
```

Stages can be skipped (`pipeline.skip("rerank")`), inputs combined (`setTextQueries`, `setSemanticQueries`, `setEmbeddings`), and traces enabled (`setExplain(true)`).

### Reranker blending

`blendWithReranker()` combines initial retrieval scores with reranker scores using position-aware tiers. Top-ranked items are protected by higher retrieval weights (default: 0.75 for top-3, 0.60 for top-10, 0.40 for the rest), preventing aggressive rerankers from destabilizing high-confidence results.

```ts
import { blendWithReranker, DEFAULT_BLEND_TIERS } from "@statewalker/indexer-search";

const blended = blendWithReranker(retrievalResults, rerankScores, DEFAULT_BLEND_TIERS);
```

### Structured query parsing

```ts
import { parseStructuredQuery } from "@statewalker/indexer-search";

const parsed = parseStructuredQuery("lex: CAP theorem\nvec: consensus algorithms");
// [{ type: "lex", query: "CAP theorem" }, { type: "vec", query: "consensus algorithms" }]
```

Recognised prefixes:

- `lex:` — lexical/keyword query
- `vec:` — vector/semantic query
- `hyde:` — hypothetical document embedding query
- `expand:` — pass-through (returns `null` for default pipeline handling)

Validators (`validateLexQuery`, `validateSemanticQuery`) catch malformed queries before they reach the backend.

### Intent disambiguation

`extractIntentTerms()` strips stop-words from a user's intent description, and `selectBestChunk()` uses both query terms and intent terms to pick the most relevant text chunk — useful for snippet extraction and context selection.

### Mocks

The mock factories return deterministic implementations of `QueryExpanderFn`, `RerankerFn`, and `CitationBuilderFn`, useful for unit-testing pipeline wiring without standing up real LLM calls.

```ts
import {
  createMockCitationBuilder,
  createMockExpander,
  createMockReranker,
} from "@statewalker/indexer-search";

const pipeline = new SearchPipeline({
  index,
  embedFn: embed,
  expander: createMockExpander(),
  reranker: createMockReranker(),
  citationBuilder: createMockCitationBuilder(),
});
```

## Where the rank-fusion math lives

`reciprocalRankFusion` (RRF) and the `mergeHybrid` family are backend-implementation glue and live in `@statewalker/indexer-core` (workspace-internal, not published). `SearchPipeline` does not call them directly — it issues a single `index.search(...)` call and lets each backend handle its own multi-query merge.

If you really need cross-query RRF outside a backend's `Index.search()` (rare), the `fanOutSearch` helper in `@statewalker/indexer-core` is available to backend authors.

## How it is tested

Tests use **vitest** and live in `test/`:

| Test file | What it covers |
|-----------|----------------|
| `test/reranker-blend.test.ts` | Position-aware blending, tier boundaries, re-ordering, custom tiers, edge cases |
| `test/query-parser.test.ts`   | Structured query parsing (`lex:/vec:/hyde:/expand:`), validation, error cases |
| `test/intent.test.ts`         | Stop-word filtering, intent term extraction, chunk selection with intent weighting |
| `test/mock.test.ts`           | Mock expander, reranker, and citation builder factory functions |

Cross-backend `SemanticIndex` conformance is exercised through `@statewalker/indexer-tests`'s `semantic-index.suite.ts` (run against every conforming backend).

Run tests:

```bash
pnpm test
pnpm test:watch
```

Several algorithms (query parser, intent extraction, reranker blending) are adapted from [QMD](https://github.com/tobi/qmd) by Tobi Lutke (MIT License).
