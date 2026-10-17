# @statewalker/indexer-sqlite

## What it is

An `Indexer` whose full-text (FTS5), vector and n-gram/grep sub-indexes all live in one SQLite
`Db` from `@statewalker/db-api`: `node:sqlite` on Node.js, sqlite-wasm in a browser worker, or a
Durable Object's `ctx.storage.sql`. Each modality is a provider you register; an Index combines
any number of named sub-indexes and fuses their results by reciprocal rank fusion (RRF).

## Why it exists

One SQLite file holds every modality of every Index, so there is nothing to save or load: a new
indexer over the same database lists the indexes and searches the old data. Inside a Durable
Object it runs on the object's own SQLite storage, so a cold start opens the indexes where they
are, with nothing to load. The n-gram sub-index answers exact substring and regex queries (`fooBar(`, `\bTODO\b`)
that word-based full-text search cannot.

## How to use

```sh
pnpm add @statewalker/indexer-sqlite
```

- `createSqliteIndexer({ db, providers }): Promise<Indexer>` — `db` is a `Db` from
  `@statewalker/db-sqlite-node`, `@statewalker/db-sqlite-do` or another `@statewalker/db-sqlite*`
  driver. Pass one provider per modality your indexes use; for all three:
  `[newSqliteFullTextProvider(), newSqliteVectorProvider(), newSqliteNgramProvider()]`. A
  sub-index type with no provider fails `createIndex` and `getIndex` (see below).
- The indexer never closes `db`. `indexer.close()` closes the open indexes; close the `Db`
  yourself.
- Sub-indexes are configured, queried and read with the modality packages:
  `@statewalker/indexer-fulltext`, `@statewalker/indexer-vector`, `@statewalker/indexer-ngram`
  (including its `grep` helper).
- `SqliteModalityProvider`, `openBlockIds`, `newEnumeration` and `pathPrefixSql` are exported for
  writing another provider.

## Examples

Node.js, with a file database and all three modalities:

```ts
import { newNodeSqliteDb } from "@statewalker/db-sqlite-node";
import { newFullTextAccess, setFullTextConfig } from "@statewalker/indexer-fulltext";
import { grep, newNgramAccess, setNgramConfig } from "@statewalker/indexer-ngram";
import { newVectorAccess, setVectorConfig } from "@statewalker/indexer-vector";
import {
  createSqliteIndexer,
  newSqliteFullTextProvider,
  newSqliteNgramProvider,
  newSqliteVectorProvider,
} from "@statewalker/indexer-sqlite";

const db = await newNodeSqliteDb({ path: "./search.sqlite" });
const indexer = await createSqliteIndexer({
  db,
  providers: [newSqliteFullTextProvider(), newSqliteVectorProvider(), newSqliteNgramProvider()],
});

const params = { name: "docs" };
setFullTextConfig(params, "text", { language: "en" });
setVectorConfig(params, "emb", { dimensionality: 3, model: "my-model" });
setNgramConfig(params, "code", { store: "fts5" });
const index = await indexer.createIndex(params);

const text = newFullTextAccess("text");
const emb = newVectorAccess("emb");
const code = newNgramAccess("code");
const block = { path: "/src/a.ts" as const, blockId: "1" };
const content = "function fooBar() {\n  return running(fooBar);\n}\n";
await text.get(index).addDocument([{ ...block, content }]);
await emb.get(index).addDocument([{ ...block, embedding: Float32Array.of(0.1, 0.9, 0) }]);
await code.get(index).addDocument([{ ...block, content }]);

// One fused search over all three sub-indexes.
const request = { topK: 10 };
text.setQuery(request, { queries: ["run"] }); // Porter stemming: matches "running"
emb.setQuery(request, { embeddings: [Float32Array.of(0, 1, 0)] });
code.setQuery(request, { pattern: "fooBar" });
for await (const r of index.search(request)) {
  console.log(r.path, r.blockId, r.score, code.getResult(r)?.count); // RRF score; 2 matches
}

// grep: every match with offsets and lines, plus whether the search was cut short.
const { hits, truncated } = await grep(index, "code", "fooBar\\(", { regex: true });
console.log(hits[0]?.matches, truncated); // [{ start: 9, end: 16, line: 1 }] false

await indexer.close();
await db.close();
```

Inside a Durable Object (`newDoSqliteDb` is synchronous; the indexer is created on first use):

```ts
import { DurableObject } from "cloudflare:workers";
import { newDoSqliteDb } from "@statewalker/db-sqlite-do";
import type { Indexer } from "@statewalker/indexer-api";
import {
  createSqliteIndexer,
  newSqliteFullTextProvider,
  newSqliteNgramProvider,
  newSqliteVectorProvider,
} from "@statewalker/indexer-sqlite";

export class Search extends DurableObject {
  db = newDoSqliteDb(this.ctx.storage);
  #indexer?: Promise<Indexer>;

  indexer(): Promise<Indexer> {
    this.#indexer ??= createSqliteIndexer({
      db: this.db,
      providers: [newSqliteFullTextProvider(), newSqliteVectorProvider(), newSqliteNgramProvider()],
    });
    return this.#indexer;
  }
}
```

In Node.js tests, `newDoSqliteDb(newFakeDoStorage())` (from `@statewalker/db-sqlite-do/fake`)
gives a `Db` with the Durable Object's limits.

## Internals

### Tables are prefixed per index and sub-index, and names are case-distinct

```
__indexer_manifest(name, config)                      one row per Index: its sub-index configs
idx_<index>__blocks(id INTEGER PRIMARY KEY, path, block_id)    shared by every sub-index
idx_<index>__<sub>_fts                                FTS5 table, rowid = block id
idx_<index>__<sub>_vec_*                              the vector engine's tables
idx_<index>__<sub>_ng_*                               the n-gram engine's tables
```

Index and sub-index names are escaped into the prefixes, upper-case letters included: SQLite table names ignore case, so `Docs` and `docs` become distinct prefixes and are independent indexes. The vector and n-gram sub-indexes
compute size and listings by joining the engine's own id table with the blocks table, so nothing
lists a block the engine does not hold, and there is no second write that a crash could separate
from the engine's write.

### Why blocks get integer ids

The engines (`@statewalker/db-sqlite-index`) index integer ids, not `{path, blockId}` pairs. The
blocks table maps one to the other, and its rows are kept until `deleteIndex`, even after a
block is deleted from every sub-index: an id stays stable for its block, so an engine never sees
one id reused for different content. Re-adding a `{path, blockId}` replaces its content; it never
creates a second entry.

### Why each modality uses its own table prefix

The vector and n-gram engines both create a `{prefix}meta` table with different columns. Each
provider therefore appends its own suffix (`fts`, `vec_`, `ng_`) to the sub-index prefix; a new
provider must do the same.

### Path scope uses `substr`, not `LIKE`, and one JSON parameter

A path prefix matches on component boundaries (`/foo` matches `/foo` and `/foo/x`, never
`/foobar`) and case-sensitively (`/Docs` does not match `/docs/a`). SQLite's `LIKE` ignores ASCII
case, and `PRAGMA case_sensitive_like` is not authorised in a Durable Object, so the condition is
built with `substr`. All prefixes are passed as a single JSON parameter (`json_each`), because
a Durable Object rejects statements with more than 100 bound variables; any number of `paths` works.

### Full text runs on FTS5 with stemming for exactly "en"

- Only the exact language `"en"` gets the Porter stemmer (`porter unicode61 remove_diacritics
  2`). Every other value, including `"en-US"` and unknown codes, gets `unicode61
  remove_diacritics 2` without stemming; no language throws.
- Each query string is split into words; every word with a letter or a digit is double-quoted
  and the words are OR-joined, so FTS5 syntax in user text (`"`, `*`, `AND`, `NEAR(`, `-`) is
  searched as plain words and never raises `fts5: syntax error`. Text with no letters or digits
  finds nothing.
- `score = -bm25(...)`; the snippet is `snippet(<table>, 0, '', '', '…', 16)`.
- Several `queries` in one sub-query **add up** (SUM): a block matching more of them ranks
  higher. The PGlite and DuckDB indexers keep each block's best single query instead, so the same
  request can rank differently there. Each query is cut to `topK` before summing, so a block just
  below the cut-off in one query loses that part of its score.

### Vector sub-indexes use cosine scores and do not store block metadata

Cosine metric; `score = 1 − distance`. Several embeddings in one query keep each block's best
score. The engine commits an `upsert` in transactions of 200 vectors: if a call fails part-way,
the earlier batches stay written.
`VectorBlock.metadata` is not stored. `getDocumentsBlocks` returns the cosine-normalised vectors, not the embeddings that were added.

### N-gram sub-indexes answer grep, with a bounded candidate budget

- `store` is `"fts5"` (default) or `"postings"`; both give the same results.
- `caseSensitive` defaults to `true`, as in grep. A literal pattern is matched exactly; with
  `regex: true` it is a JavaScript regex without the `u` flag, and `\p{…}` / `\P{…}` are rejected
  with a `SyntaxError`.
- Matches stay inside one block. Offsets are UTF-16 code units of the stored text (lone
  surrogates are stored as U+FFFD), `end` exclusive; `line` is 1-based, counted from `\n`.
- `score = count`, the number of matches in the block. The engine returns its first `topK`
  matching blocks (default 100) in ascending id order; the provider then ranks those by count.
  When `topK` or the engine's candidate budget (10,000 candidates) cut the search short, `grep`
  returns `truncated: true` and the hits are the ones found so far, not necessarily the blocks with
  the most matches.
- `NgramBlock.metadata` is not stored (the full-text sub-index does store it).
- A `paths`-scoped search spends the candidate budget on out-of-scope blocks too: the engine
  filters by path after it cuts to the budget, so a narrow scope in a large index can return few
  hits together with `truncated: true` although more matches exist in scope.
- `addDocument` hands the engine at most 500 blocks per write transaction; each batch commits on
  its own, so if a later batch fails the earlier ones stay written.

### Dependencies: the Db, the engines and the modality contracts

- `@statewalker/db-api` — the `Db` it runs on.
- `@statewalker/db-sqlite` — `inTransaction` (FTS writes).
- `@statewalker/db-sqlite-index` — the vector (`./vector`) and n-gram (`./ngram`) engines.
- `@statewalker/indexer-api`, `@statewalker/indexer-core` — the `Indexer` contract, RRF
  composition, shared helpers.
- `@statewalker/indexer-fulltext`, `@statewalker/indexer-vector`, `@statewalker/indexer-ngram` —
  the modality contracts the providers implement.

## What will surprise you

- **A wrapped `Db` loses the transaction hook.** Pass the driver's `Db` itself, not an object
  that forwards to it. With a wrapper, creating an Index with a vector or n-gram sub-index, or
  the first write to a full-text sub-index, rejects with:
  `inTransaction: this Db has no SQLite transaction hook. It is not a @statewalker/db-sqlite* Db,
  or it wraps one (a wrapper object loses the hook - pass the driver's Db itself), or it is the
  handle of a running transaction (nesting is not supported).`
- **Never call an indexer, an Index or a sub-index from inside your own
  `inTransaction(db, …)` callback.** The sub-indexes run their own transactions and queries on
  `db`; on Node.js and in the browser those wait for your transaction to end, and it waits for
  them. The call hangs, with no error.
- **A provider's `open` and `drop` must not call back into the indexer** (`getIndex`,
  `createIndex`): the indexer runs them inside its own one-at-a-time queue, and a nested call waits
  for itself forever.
- **Durable Object limits apply to every write.** A single string or BLOB value over about 2 MB
  rejects with `string or blob too big`, so very large blocks must be split before indexing. An
  operation that runs past the platform's deadline (15 s on celld) is retried rather than failed;
  keep each `addDocument` call modest.
- **`truncated: true` is easy to miss.** `for await (const hit of sub.search(q))` drops the
  summary the generator returns; use `grep` to read it.
- **Re-opening needs the same providers.** `getIndex` on an Index with a sub-index whose type has
  no registered provider throws `Cannot load index: sub-index "<name>" requires modality
  "<type>" but only [...] are registered.`; pass `{ onMissingProvider: "warn" }` to open it
  without that sub-index.

## License

MIT
