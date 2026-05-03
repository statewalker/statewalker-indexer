# @statewalker/indexer-api

Backend-agnostic TypeScript contract for hybrid search indexes combining **full-text search (FTS)** and **vector/embedding similarity search**.

## Why this API?

Modern search applications need more than keyword matching. They need to combine lexical precision (finding exact terms) with semantic understanding (finding conceptually similar content). Building this requires:

- **Full-text search** for exact keyword and phrase matching with relevance scoring.
- **Vector search** for semantic similarity using embedding models.
- **Hybrid search** that blends both modalities into a single ranked result list.

Each of these capabilities can be backed by very different storage engines — in-memory structures, SQLite/PGlite, DuckDB, or external services. Without a shared abstraction, application code becomes tightly coupled to a specific backend, making it hard to swap implementations, test in isolation, or run the same logic in different environments (browser, Node, edge).

`@statewalker/indexer-api` solves this by defining a **pure-interface contract** with **zero runtime exports**. Application code programs against the API; concrete backends are injected at startup. The strategy stack (search pipeline, query parser, semantic index, reranker blending, mocks) lives in [`@statewalker/indexer-search`](../indexer-search/README.md).

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

| Capability      | Methods |
|-----------------|---------|
| **Search**      | `search()` — async generator streaming scored results |
| **Ingestion**   | `addDocument()`, `addDocuments()` — single or bulk insert |
| **Deletion**    | `deleteDocuments()` — by path prefix and/or block ID |
| **Enumeration** | `getSize()`, `getDocumentPaths()`, `getDocumentBlocksRefs()`, `getDocumentsBlocks()` |
| **Lifecycle**   | `flush()`, `close()`, `deleteIndex()` |

### Hybrid search

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

### Path-prefix filtering

Documents are organized under hierarchical paths (`"/projects/alpha/specs/"`). All search, enumeration, and deletion operations accept optional path prefixes to restrict their scope. For example, passing `paths: ["/docs/"]` to `index.search(...)` limits results to documents whose path starts with `"/docs/"`. Prefix matching is a simple `startsWith` at the type level — backends implement it using their native SQL (DuckDB / PGlite) or in-memory filtering (`indexer-mem-*`).

### Persistence

The `IndexerPersistence` interface defines a streaming save/load contract for serializing index state:

```ts
interface IndexerPersistence {
  save(entries: AsyncIterable<PersistenceEntry>): Promise<void>;
  load(): AsyncIterable<PersistenceEntry>;
}
```

### Ranking primitive

`ScoredItem = { blockId: string; score: number }` is a small primitive shape shared between the backend toolkit (`@statewalker/indexer-core`'s RRF) and the strategy stack (`@statewalker/indexer-search`'s reranker blending). Living here keeps both consumers free of cross-package coupling.

### Embedding boundary

`EmbedFn = (text: string) => Promise<Float32Array>` is the boundary type at which the application provides an embedding capability to the indexer. Both backends (via test fixtures) and the strategy stack consume it.

## Implementations / backends

| Package | Backend | Notes |
|---------|---------|-------|
| `@statewalker/indexer-mem` | In-memory (Flechette/Arrow) | Foundation layer; vector-only |
| `@statewalker/indexer-mem-minisearch` | MiniSearch + in-memory vectors | Lightweight FTS; optional persistence |
| `@statewalker/indexer-mem-flexsearch` | FlexSearch + in-memory vectors | Alternative FTS engine; optional persistence |
| `@statewalker/indexer-pglite` | PGlite + pgvector | SQL-backed; full FTS + vector |
| `@statewalker/indexer-duckdb` | DuckDB + VSS/HNSW | Analytical SQL; high-performance vector search |

Supporting packages:

| Package | Purpose |
|---------|---------|
| `@statewalker/indexer-search` | Application-side strategy stack (`SearchPipeline`, `SemanticIndex`, query parser, reranker blending, mocks) |
| `@statewalker/indexer-chunker` | Markdown splitting and code fence detection for content preprocessing |

## How to use

### Creating an index

```ts
import type { Indexer, CreateIndexParams } from "@statewalker/indexer-api";

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

For application-side ergonomics (auto-embedding, query expansion, reranking, citations, structured query parsing, intent extraction), see [`@statewalker/indexer-search`](../indexer-search/README.md).

## How it is tested

`@statewalker/indexer-api` is contract-only — it has no runtime to test. Conformance to the contract is validated per backend in `@statewalker/indexer-tests` (the cross-backend conformance runner) and in each backend package's own integration suite.
