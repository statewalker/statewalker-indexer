# @statewalker/indexer-vector

Vector / embedding modality contract for [`@statewalker/indexer-api`](../indexer-api/README.md).

Owns the **vector** types — `VectorIndex`, `VectorBlock`, `VectorQuery`, `VectorResult`, `VectorIndexInfo` — and the **adapter triple** registered at the stable key `"vector"`:

- `getVectorIndex(index)` / `registerVector(index, vec)` — read / register the vector sub-index on a composite `Index`.
- `getVectorQuery(request)` / `setVectorQuery(request, q)` — attach the vector sub-query to a `SearchRequest`.
- `getVectorResult(result)` / `setVectorResult(result, hit)` — attach the vector sub-result to a `SearchResult`.
- `getVectorConfig(params)` / `setVectorConfig(params, cfg)` — write/read the vector creation config in `CreateIndexParams.subIndexes`.

## Usage

```ts
import {
  registerVector,
  setVectorQuery,
  getVectorResult,
  setVectorConfig,
} from "@statewalker/indexer-vector";

const params = { name: "docs" };
setVectorConfig(params, { dimensionality: 384, model: "all-MiniLM-L6-v2" });
const index = await indexer.createIndex(params);

const request = { topK: 10 };
setVectorQuery(request, { embeddings: [await embed("hello")] });

for await (const r of index.search(request)) {
  const vec = getVectorResult(r);
  console.log(r.path, r.blockId, "rrf:", r.score, "cosine:", vec?.score);
}
```

## Related

- [`@statewalker/indexer-api`](../indexer-api/README.md) — kernel contract
- [`@statewalker/indexer-fulltext`](../indexer-fulltext/README.md) — full-text modality
- `@statewalker/indexer-mem` — in-memory vector backend
