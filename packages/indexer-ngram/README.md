# @statewalker/indexer-ngram

## What it is

The n-gram / regex modality contract for `@statewalker/indexer-api`: the block, query and result
types, the `NGRAM_TYPE` discriminator, config helpers, a typed access handle (`newNgramAccess`) and
a `grep` helper. It holds no engine; a backend registers a sub-index of type `"ngram"` that
implements `NgramIndex`. `@statewalker/indexer-sqlite` (`newSqliteNgramProvider()`) is such a backend.

## Why exact-match search needs its own modality

Full-text search drops punctuation and stems words, so it cannot find `fooBar(`, `TODO:` or a
regular expression. Grep needs a modality that matches the original text exactly and reports where
each match sits (offsets and line numbers). Backends implement that behind the types in this
package, so callers write against the contract and fuse grep hits with full-text and vector hits in
one `SearchRequest`.

## How to use

```ts
import { grep, newNgramAccess, setNgramConfig } from "@statewalker/indexer-ngram";
```

- `setNgramConfig(params, name, { store? })` declares the sub-index in `CreateIndexParams`.
- `newNgramAccess(name).get(index)` returns the typed `NgramIndex` for ingestion
  (`addDocument`, ...) and `search`.
- `grep(index, name, pattern, options?)` runs a search and returns `{ hits, truncated }`.

## Examples

Config, ingest, grep:

```ts
import { grep, newNgramAccess, setNgramConfig } from "@statewalker/indexer-ngram";

const params = { name: "code" /* ... */ };
setNgramConfig(params, "grep", {}); // backend picks the store

// `indexer` is a backend that handles type "ngram"; `index` came from it.
const ngram = newNgramAccess("grep");
await ngram.get(index).addDocument([
  { path: "/src/a.ts", blockId: "0", content: "const x = fooBar(1); // TODO: fix" },
]);

const { hits, truncated } = await grep(index, "grep", "TODO:");
// hits[0] -> { path: "/src/a.ts", blockId: "0", score: 1, count: 1,
//              matches: [{ start: 24, end: 29, line: 1 }] }

const re = await grep(index, "grep", "foo[A-Z]\\w+\\(", { regex: true, topK: 20 });
```

Fused with other modalities in one request:

```ts
import type { SearchRequest } from "@statewalker/indexer-api";

const request: SearchRequest = { topK: 10 };
ngram.setQuery(request, { pattern: "fooBar(", caseSensitive: false });
// ... set the full-text / vector sub-queries on the same request ...
for await (const entry of index.search(request)) {
  const hit = ngram.getResult(entry); // NgramResult | undefined
}
```

## Internals

- **Score is the match count.** `NgramResult.score === count`; `matches` lists every match found in
  the block.
- **Matches never cross blocks.** A pattern spanning two blocks does not match.
- **Offsets.** `start`/`end` are UTF-16 code-unit offsets into the original block text, `end`
  exclusive; `line` is 1-based.
- **Case.** `caseSensitive` defaults to `true` (grep semantics).
- **Limits.** `topK` defaults to 100 and caps returned blocks; `topK: 0` returns no hits. A backend
  may stop verifying candidates early (the SQLite backend's candidate budget is 10,000). Either cut
  sets `truncated: true`.
- **Regex dialect.** `regex: true` compiles a JavaScript regular expression without the `u` flag:
  `.` matches one UTF-16 code unit and `\u{...}` is not a code-point escape. Patterns containing
  `\p{` or `\P{` are rejected with a `SyntaxError`; Unicode-property escapes are not supported.
- **`truncated` travels as the generator's return value.** `NgramIndex.search` yields hits and
  returns `{ truncated }`. A `for await` over `search` silently ignores truncation and shows
  possibly incomplete results as complete; use `grep`, which reads the return value.
- **Dependencies.** Only `@statewalker/indexer-api`; no engine, no database package.

## License

MIT
