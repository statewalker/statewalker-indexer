# @repo/indexer-api

Backend-agnostic TypeScript API for hybrid search indexes combining **full-text search (FTS)** and **vector/embedding similarity search**.

## Why this API?

Modern search applications need more than keyword matching. They need to combine lexical precision (finding exact terms) with semantic understanding (finding conceptually similar content). Building this requires:

- **Full-text search** for exact keyword and phrase matching with relevance scoring.
- **Vector search** for semantic similarity using embedding models.
- **Hybrid search** that blends both modalities into a single ranked result list.

Each of these capabilities can be backed by very different storage engines — in-memory structures, SQLite/PGlite, DuckDB, or external services. Without a shared abstraction, application code becomes tightly coupled to a specific backend, making it hard to swap implementations, test in isolation, or run the same logic in different environments (browser, Node, edge).

`@repo/indexer-api` solves this by defining a **pure-interface contract** with zero runtime dependencies. Application code programs against the API; concrete backends are injected at startup.

## How it works

### Core abstractions

The API is organized in layers:

```
Indexer          — registry/factory: creates, lists, deletes named indexes
  └─ Index       — hybrid index accepting IndexedBlocks (text + embedding)
       ├─ FullTextIndex   — FTS sub-index operating on FullTextBlocks
       └─ EmbeddingIndex  — vector sub-index operating on EmbeddingBlocks
```

**Documents** are identified by hierarchical paths (`DocumentPath = "/${string}"`) and subdivided into **blocks** (`BlockId`). A block may carry text content, an embedding vector, or both. Path prefixes enable scoped searches and bulk deletions (e.g., `"/docs/"` matches all documents under that prefix).

Every index provides a uniform contract (`SearchIndex<B, P, R>`) covering:

| Capability    | Methods |
|---------------|---------|
| **Search**    | `search()` — async generator streaming scored results |
| **Ingestion** | `addDocument()`, `addDocuments()` — single or bulk insert |
| **Deletion**  | `deleteDocuments()` — by path prefix and/or block ID |
| **Enumeration** | `getSize()`, `getDocumentPaths()`, `getDocumentBlocksRefs()`, `getDocumentsBlocks()` |
| **Lifecycle** | `flush()`, `close()`, `deleteIndex()` |

### Hybrid search & score fusion

Hybrid search accepts both FTS queries and embedding vectors simultaneously. Results from each modality are blended using configurable `HybridWeights`:

```ts
index.search({
  queries: ["CAP theorem"],
  embeddings: [await embed("distributed consensus")],
  topK: 10,
  weights: { fts: 0.7, embedding: 0.3 },
});
```

When only one modality is provided, the search gracefully degrades to single-modality mode.

### Reciprocal Rank Fusion (RRF)

The `reciprocalRankFusion()` function merges multiple ranked lists into a single ranking. It supports:

- **Weighted lists** — each list can carry a weight that scales its contribution.
- **Top-rank bonus** — items ranked #1 get a +0.05 bonus; ranks #2-3 get +0.02 (adapted from [QMD](https://github.com/tobi/qmd)).
- **Tracing** — `buildRrfTrace()` returns per-item contribution breakdowns for debugging and explainability.

### Reranker blending

`blendWithReranker()` combines initial retrieval scores with reranker scores using position-aware tiers. Top-ranked items are protected by higher retrieval weights (default: 0.75 for top-3, 0.60 for top-10, 0.40 for the rest), preventing aggressive rerankers from destabilizing high-confidence results.

### Multi-search

`defaultMultiSearch()` fans out multiple queries and embeddings into independent searches, then fuses them with RRF. It tracks `matchCount` (how many input queries matched each result) and supports grouping results by document path for organized output.

### Query parsing

`parseStructuredQuery()` parses typed search instructions with prefixes:

- `lex:` — lexical/keyword query
- `vec:` — vector/semantic query
- `hyde:` — hypothetical document embedding query
- `expand:` — pass-through (returns `null` for default pipeline handling)

Validators (`validateLexQuery`, `validateSemanticQuery`) catch malformed queries before they reach the backend.

### Intent disambiguation

`extractIntentTerms()` strips stop-words from a user's intent description, and `selectBestChunk()` uses both query terms and intent terms to pick the most relevant text chunk — useful for snippet extraction and context selection.

### Path-prefix filtering

Documents are organized under hierarchical paths (`"/projects/alpha/specs/"`). All search, enumeration, and deletion operations accept optional path prefixes to restrict their scope. For example, passing `paths: ["/docs/"]` to `index.search(...)` limits results to documents whose path starts with `"/docs/"`. Prefix matching is a simple `startsWith` at the type level — backends implement it using their native SQL (DuckDB / PGlite) or in-memory filtering (indexer-mem-*).

### Persistence

The `IndexerPersistence` interface defines a streaming save/load contract for serializing index state:

```ts
interface IndexerPersistence {
  save(entries: AsyncIterable<PersistenceEntry>): Promise<void>;
  load(): AsyncIterable<PersistenceEntry>;
}
```

### SemanticIndex convenience wrapper

`SemanticIndex` wraps an `Index` and an `EmbedFn` to automatically compute embeddings at ingestion and search time. Application code provides plain text; the wrapper handles embedding generation transparently.

### SearchPipeline

`SearchPipeline` is a builder/executor for multi-stage search with optional LLM-powered stages. It chains: **expand** (query expansion) → **embed** (semantic query embedding) → **search** (single `index.search()` call) → **rerank** (score blending) → **cite** (citation extraction). Each LLM stage is defined as a function type (`QueryExpanderFn`, `RerankerFn`, `CitationBuilderFn`) — no class instantiation required, just pass closures.

### indexDocuments utility

`indexDocuments()` is a convenience function for batch document ingestion with optional auto-embedding. It accepts a sync or async iterable of documents and an optional `embedFn`, and returns a count of indexed documents.

## Implementations / backends

| Package | Backend | Notes |
|---------|---------|-------|
| `@repo/indexer-mem` | In-memory (Flechette/Arrow) | Foundation layer; vector-only |
| `@repo/indexer-mem-minisearch` | MiniSearch + in-memory vectors | Lightweight FTS; optional persistence |
| `@repo/indexer-mem-flexsearch` | FlexSearch + in-memory vectors | Alternative FTS engine; optional persistence |
| `@repo/indexer-pglite` | PGlite + pgvector | SQL-backed; full FTS + vector |
| `@repo/indexer-duckdb` | DuckDB + VSS/HNSW | Analytical SQL; high-performance vector search |

Supporting packages:

| Package | Purpose |
|---------|---------|
| `@repo/indexer-chunker` | Markdown splitting and code fence detection for content preprocessing |

## How to use

### Creating an index

```ts
import type { Indexer, CreateIndexParams } from "@repo/indexer-api";

// Obtain an Indexer from a concrete backend (e.g., MiniSearch, PGlite, DuckDB)
const indexer: Indexer = createMiniSearchIndexer(/* ... */);

const index = await indexer.createIndex({
  name: "docs",
  fulltext: { language: "english" },
  vector: { dimensionality: 384, model: "all-MiniLM-L6-v2" },
});
```

### Ingesting documents

```ts
await index.addDocument([
  {
    path: "/docs/readme/",
    blockId: "intro",
    content: "Welcome to the project...",
    embedding: await embed("Welcome to the project..."),
  },
  {
    path: "/docs/readme/",
    blockId: "setup",
    content: "To get started, install...",
    embedding: await embed("To get started, install..."),
  },
]);
```

### Searching

```ts
// Hybrid search
for await (const result of index.search({
  queries: ["getting started"],
  embeddings: [await embed("how to set up the project")],
  topK: 5,
  weights: { fts: 0.6, embedding: 0.4 },
})) {
  console.log(result.path, result.blockId, result.score);
}

// Scoped search — restrict to a path prefix
for await (const result of index.search({
  queries: ["install"],
  topK: 10,
  paths: ["/docs/guides/"],
})) {
  console.log(result.blockId, result.fts?.snippet);
}

// FTS-only (omit embeddings)
for await (const result of index.search({
  queries: ["install"],
  topK: 10,
})) {
  console.log(result.blockId, result.fts?.snippet);
}
```

### Using SemanticIndex for automatic embedding

```ts
import { SemanticIndex } from "@repo/indexer-api";

const semantic = new SemanticIndex(index, embed);

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

### Multi-search with RRF fusion

```ts
import { defaultMultiSearch } from "@repo/indexer-api";

const results = await defaultMultiSearch(index, {
  queries: ["CAP theorem", "consistency models"],
  embeddings: [await embed("distributed systems trade-offs")],
  topK: 10,
  weights: { fts: 0.6, embedding: 0.4 },
});
```

### Structured queries

```ts
import { parseStructuredQuery } from "@repo/indexer-api";

const parsed = parseStructuredQuery("lex: CAP theorem\nvec: consensus algorithms");
// [{ type: "lex", query: "CAP theorem" }, { type: "vec", query: "consensus algorithms" }]
```

### SearchPipeline

```ts
import { SearchPipeline } from "@repo/indexer-api";

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

### Batch indexing with indexDocuments

```ts
import { indexDocuments } from "@repo/indexer-api";

const { indexed } = await indexDocuments(index, [
  { path: "/docs/", blockId: "b1", content: "First document..." },
  { path: "/docs/", blockId: "b2", content: "Second document..." },
], { embedFn: embed });
```

## How it is tested

Tests use **vitest** and live in `test/`, mirroring the `src/` structure. The package has **7 test suites** covering the pure-logic modules:

| Test file | What it covers |
|-----------|----------------|
| `test/rrf.test.ts` | RRF score computation, weighted lists, top-rank bonuses, trace correctness |
| `test/reranker-blend.test.ts` | Position-aware blending, tier boundaries, re-ordering, custom tiers, edge cases |
| `test/query-parser.test.ts` | Structured query parsing (`lex:/vec:/hyde:/expand:`), validation, error cases |
| `test/intent.test.ts` | Stop-word filtering, intent term extraction, chunk selection with intent weighting |
| `test/helpers/search-pipeline.test.ts` | SearchPipeline builder, FTS execution, expansion, reranking, citations, explain traces, error handling |
| `test/helpers/mock.test.ts` | Mock expander, reranker, and citation builder factory functions |
| `test/helpers/index-documents.test.ts` | Batch indexing utility with sync/async iterables and auto-embedding |

The interface types (`Indexer`, `Index`, `FullTextIndex`, `EmbeddingIndex`) are not tested here — they are pure TypeScript interfaces with no runtime behavior. Each backend package (`indexer-mem`, `indexer-pglite`, `indexer-duckdb`, etc.) has its own integration test suite that validates conformance to these interfaces.

Run tests:

```bash
# Run once
pnpm test

# Watch mode
pnpm test:watch
```

Several algorithms (RRF, query parser, intent extraction, reranker blending) are adapted from [QMD](https://github.com/tobi/qmd) by Tobi Lutke (MIT License).
