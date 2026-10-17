# @statewalker/indexer-vector

## What it is

The vector (embedding) modality for `@statewalker/indexer-api`: the sub-index types (`VectorIndex`, `VectorBlock`, `VectorQuery`, `VectorResult`), the `VectorProvider` interface that backends implement, config helpers for `CreateIndexParams`, and `newVectorAccess(name)`, a typed handle bound to one sub-index name. The modality type string is `"vector"` (`VECTOR_TYPE`).

## Why it exists

The kernel addresses sub-indexes by name and stores queries and results as `unknown`. This package adds the vector types and a handle that reads and writes the sub-index, its config, its sub-query and its sub-result under one name. Several vector sub-indexes (for example content embeddings and summary embeddings, or two embedding models) can coexist on one index.

## How to use

```sh
pnpm add @statewalker/indexer-vector
```

One entry point, `@statewalker/indexer-vector`. Platform-neutral.

- `setVectorConfig(params, name, { dimensionality, model, metadata? })` before `indexer.createIndex(params)`.
- `newVectorAccess(name)` returns `{ name, get, tryGet, setConfig, getConfig, setQuery, getQuery, getResult }`.

## Examples

```ts
import { newVectorAccess, setVectorConfig } from "@statewalker/indexer-vector";

const params = { name: "docs" };
setVectorConfig(params, "semantic", { dimensionality: 384, model: "all-MiniLM-L6-v2" });
const index = await indexer.createIndex(params);

const vec = newVectorAccess("semantic");
await vec.get(index).addDocument([
  { path: "/docs/a", blockId: "1", embedding: await embed("hello world") },
]);

const request = { topK: 10 };
vec.setQuery(request, { embeddings: [await embed("hello")], topK: 50 });
for await (const r of index.search(request)) {
  console.log(r.path, r.blockId, "rrf:", r.score, "cosine:", vec.getResult(r)?.score);
}
```

Implement a provider in a backend:

```ts
import { VECTOR_TYPE, type VectorProvider } from "@statewalker/indexer-vector";

export const myProvider: VectorProvider = {
  type: VECTOR_TYPE,
  create: (config) => new MyVectorIndex(config), // must implement VectorIndex
};
```

## Internals

- `setVectorConfig` writes `params.subIndexes[name] = { type: "vector", ...config }`.
- `VectorBlock.embedding` and `VectorQuery.embeddings` are `Float32Array`. Their length must equal `dimensionality`; all current backends throw `Expected dimensionality 384, got 768` (with your numbers) on `addDocument` otherwise, and on `search` too except SQLite, whose `search` throws `vector-index: expected 384 dims, got 768`.
- `VectorQuery` is `{ embeddings, topK?, paths? }`. With several embeddings, every current backend keeps each block's best similarity across them (not a sum). `topK` and `paths` here are what the sub-index uses; the top-level request values are not forwarded to it.
- `VectorResult` is `{ path, blockId, score }` with a similarity score (cosine in all current backends).
- `model` is stored with the sub-index so a caller can detect that saved vectors came from another model and reinitialise the sub-index (`indexer.getIndex(name, { subIndexes: { semantic: { type: "vector", ... } } })`).
- Dependencies: `@statewalker/indexer-api` only.

## License

MIT
