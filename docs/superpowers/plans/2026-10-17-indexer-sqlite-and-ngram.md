# P5 — indexer-pglite on `Db`, the `indexer-ngram` contract, and `indexer-sqlite` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `indexer-pglite` onto `Db`, add the `indexer-ngram` contract with `grep`, and build `indexer-sqlite` — one SQLite `Db` holding FTS5, vector and n-gram sub-indexes behind the `Indexer` contract, on Node and in Durable Objects.

**Architecture:** `indexer-sqlite` has its own kernel: `createSqliteIndexer({ db, providers })` keeps a `__indexer_manifest` table and one shared `blocks` id table per Index, opens each sub-index through an async `SqliteModalityProvider.open(ctx, config)`, and fuses with `createCompositeIndex` (RRF) from `indexer-core`. The FTS provider is plain FTS5 SQL; the vector and n-gram providers wrap the id-based engines from `@statewalker/db-sqlite-index` and map integer ids to `{path, blockId}` through the blocks table. `indexer-api` and `createSqlIndexer` are untouched.

**Tech Stack:** TypeScript, pnpm 10 workspace + catalogs, tsdown, vitest 5, biome 2, changesets; SQLite through `@statewalker/db-api` `Db` (`node:sqlite` driver, DO driver + fake DO storage), PGlite through `@statewalker/db-pglite`.

**Spec:** `~/workspace-statewalker/notes/2026/2026-10/2026-10-17/grill-sqlite-db-indexing.md` (D5 indexer side, D6, D9, D10, D13, D14 indexer suites, D15 P5).

## Global Constraints

- `@statewalker/db-api` is unchanged; every SQL call goes through `Db.query(sql, params)` / `Db.exec(sql)`.
- Transactions only through `inTransaction(db, cb)` from `@statewalker/db-sqlite`. Inside the callback use **only** `tx`, never the outer `db` (the Node/browser helper serialises: an outer call inside a callback waits forever). Callbacks do no external I/O and are idempotent (DO may retry).
- DO limits apply to every statement: no `BEGIN`/`SAVEPOINT`/`PRAGMA`; at most ~100 bound parameters — id lists go through `json_each(?)` with one JSON string; BLOB ≤ ~1.5 MB.
- SQLite placeholders are `?`; PGlite placeholders are `$n`.
- `indexer-api` and `indexer-core`'s `createSqlIndexer` are not modified.
- `indexer-vector` stays the vector contract (D9); no new vector contract package.
- FTS5 tokenizer: `en` → `porter unicode61 remove_diacritics 2`; any other language → `unicode61 remove_diacritics 2`; unknown languages never throw.
- FTS words are quoted and OR-joined; score = `-bm25`; several `queries` merge by **SUM**; snippet = `snippet(<table>, 0, '', '', '…', 16)`.
- N-gram matches stay inside one block; `NgramResult.score = count`.
- File names kebab-case. Every new package has a `README.md` in the same task (two-shape README rules from `~/.claude/rules.md`, template `packages/PACKAGE_README.template.md`). Every package change carries a changeset.
- Per task, before commit: `pnpm --filter <pkg> test`, `pnpm --filter <pkg> typecheck`, `pnpm biome check --write --unsafe <paths>`.
- Commits end with the session attribution lines from the system reminder.

## Execution context (cross-repo linking)

This plan runs inside the coordinated feature worktree of the thematic umbrella (D16, `umbrella-dev-flow`): `umbrella-sqlite-indexing` with `workspaces/statewalker-db`, `workspaces/webrun-files`, `workspaces/statewalker-search` as submodules; feature worktree `umbrella-sqlite-indexing__sqlite-db`, branch `feat/sqlite-db` everywhere. It is set up at execution time with the skill, before P1, not by a plan task. `node scripts/cli.mjs link` writes `pnpm.overrides` forcing every local `@statewalker/*` package to `workspace:*`, so the `catalog:` dependencies added below resolve to the P1–P3 packages built earlier on the same branch. P1 (`db-sqlite`, `db-sqlite-node` on `node:sqlite`, `db-sqlite-do`, `db-pglite`), P2 (`db-sqlite-index/vector`) must be green before Task 5 and P3 (`db-sqlite-index/ngram`) before Task 6; Tasks 1–4 need only P1.

The catalog entries added in `statewalker-search/pnpm-workspace.yaml` carry the versions P1–P3 will publish. Run all commands below from `workspaces/statewalker-search` inside the umbrella worktree after `pnpm install` at the umbrella root.

### Consumed contracts (from P1–P3 — exact)

```ts
// @statewalker/db-sqlite (P1)
export function inTransaction<T>(db: Db, cb: (tx: Db) => Promise<T>): Promise<T>;
// @statewalker/db-sqlite-node (P1)
export function newNodeSqliteDb(options?: { path?: string }): Promise<Db>;
// @statewalker/db-sqlite-do (P1) — synchronous
export function newDoSqliteDb(storage: DoSqlStorage): Db;
// @statewalker/db-sqlite-do/fake (P1, Node-only) — fake DO storage over node:sqlite with the probed DO limits
export function newFakeDoStorage(): FakeDoStorage;
// @statewalker/db-pglite (P1)
export function newPgliteDb(options?: { path?: string; extensions?: Record<string, unknown> }): Promise<Db>;

// @statewalker/db-sqlite-index/vector (P2)
export class VectorIndex {
  constructor(options: { db: Db; prefix: string; dims: number; metric?: "cosine" | "dot" | "l2" });
  init(): Promise<void>;
  upsert(items: { id: number; vector: Float32Array }[]): Promise<void>;
  delete(ids: number[]): Promise<void>;
  search(q: Float32Array, options?: { k?: number; nprobe?: number; oversample?: number; exact?: boolean; filter?: (id: number) => boolean; signal?: AbortSignal }): Promise<{ id: number; distance: number }[]>;
  /** Live ids only; vectors as stored (normalised to unit length for cosine). */
  getVectors(ids: number[]): Promise<Map<number, Float32Array>>;
  /** `${prefix}ids`: its `id INTEGER` column holds exactly the live ids — join it in SQL. */
  readonly idTable: string;
  compact(): Promise<number>; merge(): Promise<number>; get stats(): VectorIndexStats;
}
/** Drops every table of the index under `prefix`; needs no dims. */
export function dropVectorIndex(db: Db, prefix: string): Promise<void>;

// @statewalker/db-sqlite-index/ngram (P3)
export class NgramStore {
  constructor(options: { db: Db; prefix: string; store?: "fts5" | "postings" });
  init(): Promise<void>;
  upsert(items: { id: number; text: string }[]): Promise<void>;
  delete(ids: number[]): Promise<void>;
  search(pattern: string, options?: { regex?: boolean; caseSensitive?: boolean; limit?: number; candidateBudget?: number; filter?: (id: number) => boolean; signal?: AbortSignal }): Promise<{ hits: { id: number; matches: { start: number; end: number }[] }[]; truncated: boolean }>;
  /** Stored original texts of known ids; unknown ids are absent. */
  getTexts(ids: number[]): Promise<Map<number, string>>;
  /** `${prefix}texts`: its `id INTEGER` column holds exactly the stored ids — join it in SQL. */
  readonly idTable: string;
  /** Drops the tables of both stores (works without knowing the store type). */
  drop(): Promise<void>;
}
```

N-gram defaults (P3, and the same in `indexer-ngram`'s `NgramQuery` docs below): `caseSensitive` `true`, `limit` 100, `candidateBudget` 10,000, hits in ascending id order (this plan's provider then ranks by count), match offsets UTF-16 code units with exclusive `end`, `limit` caps hits (not candidates).

**Transactions are owned by the engines (confirmed in P2/P3):** every engine write (`upsert`, `delete`, `compact`, `merge`, `init`, `drop`, `dropVectorIndex`) runs its own `inTransaction` on the `Db` the engine was built with. Providers and the kernel **never call an engine from inside an `inTransaction` callback**: on Node/browser the engine's inner `inTransaction` on the outer `Db` waits for the outer transaction forever. The FTS provider, which is plain SQL, uses `inTransaction` itself.

**No per-provider `members` table:** size and enumeration join the engine's `idTable` with the kernel's blocks table, so a block is listed exactly when the engine holds it — there is no second write that a crash could separate from the engine write.

## Review Focus

1. **Path scoping is case-sensitive and boundary-aware.** SQLite `LIKE` is ASCII case-insensitive and `PRAGMA case_sensitive_like` is not authorised on DO, so `/Docs` would match `/docs/a` and `/foo` might match `/foobar`. Expected: neither matches. Pinned in Task 4 (`path-scope` test).
2. **FTS query text with FTS5 syntax** (`"`, `*`, `AND`, `NEAR(`, `-`, only punctuation) must not throw `fts5: syntax error`; it is searched as words or returns nothing. Pinned in Task 4.
3. **Re-adding the same `{path, blockId}` replaces, never duplicates** — size stays 1, old text/vector no longer found. Pinned in Tasks 4, 5 and 6.
4. **Reopen on the same `Db`** (a DO cold start): a new `createSqliteIndexer` over the same database lists the index and searches the old data; a saved type with no provider throws by default and is skipped under `"warn"`. Pinned in Task 4 (FTS) and Task 5 (missing-provider).
5. **Unknown FTS language** (`"xx"`) opens with `unicode61` and searches; it must not throw (pglite throws, SQLite must not). Pinned in Task 4.

---

## File Structure

```
statewalker-search/
  pnpm-workspace.yaml                         # Modify: catalog entries for db-* packages (Tasks 1, 4)
  .changeset/*.md                             # Create: one per task
  packages/
    indexer-pglite/                           # Task 1 — 0.2 → 0.3, takes { db: Db }
      src/pglite-indexer.ts                   # Modify
      src/dialect.ts                          # Modify: drop wrapDbAsSqlDb
      tests/suite.test.ts                     # Modify: newPgliteDb
      package.json, README.md                 # Modify
    indexer-ngram/                            # Task 2 — new contract package
      src/types.ts                            # NGRAM_TYPE, NgramBlock, NgramQuery, NgramMatch, NgramResult, NgramIndex, NgramConfig
      src/config.ts                           # setNgramConfig / getNgramConfig
      src/access.ts                           # newNgramAccess
      src/grep.ts                             # grep(index, name, pattern, opts)
      src/index.ts
      tests/grep.test.ts
      package.json, tsconfig.json, tsdown.config.ts, vitest.config.ts, README.md
    indexer-tests/
      src/conformance/ngram.suite.ts          # Task 6 — Indexer-driven n-gram suite
      src/index.ts, package.json              # Modify: export + dep on indexer-ngram
    indexer-sqlite/                           # Tasks 3–6 — new backend
      src/types.ts                            # SqliteModalityContext, SqliteModalityProvider
      src/path-sql.ts                         # case-sensitive path-prefix SQL with ? placeholders
      src/block-ids.ts                        # shared blocks table: ensure / select / refs
      src/enumeration.ts                      # size / paths / refs / entries over (member ids ⋈ blocks)
      src/create-sqlite-indexer.ts            # kernel
      src/fts-provider.ts                     # FTS5 provider
      src/vector-provider.ts                  # VectorIndex provider
      src/ngram-provider.ts                   # NgramStore provider
      src/index.ts
      tests/support/dbs.ts                    # node + fake-DO Db factories, IndexerFactory with reopen
      tests/support/as-modality-provider.ts   # async provider → sync ModalityProvider for provider suites
      tests/kernel.test.ts                    # Task 3
      tests/fts.test.ts                       # Task 4
      tests/vector.test.ts                    # Task 5
      tests/ngram.test.ts                     # Task 6
      package.json, tsconfig.json, tsdown.config.ts, vitest.config.ts, README.md
```

---

### Task 1: `indexer-pglite` 0.3 takes `{ db: Db }`

**Files:**
- Modify: `pnpm-workspace.yaml` (catalog)
- Modify: `packages/indexer-pglite/src/pglite-indexer.ts`
- Modify: `packages/indexer-pglite/src/dialect.ts:1-20`
- Modify: `packages/indexer-pglite/tests/suite.test.ts`
- Modify: `packages/indexer-pglite/package.json`, `packages/indexer-pglite/README.md`
- Create: `.changeset/indexer-pglite-on-db.md`

**Interfaces:**
- Consumes: `newPgliteDb(options?: { path?; extensions? }): Promise<Db>` (P1); `Db` from `@statewalker/db-api`.
- Produces: `createPGLiteIndexer(options: { db: Db }): Promise<Indexer>`; `PGLiteIndexerOptions = { db: Db }`. The indexer never closes `db`.

- [ ] **Step 1: Add catalog entries**

In `pnpm-workspace.yaml` under `catalog:` (keep alphabetical order of the `@statewalker/*` block):

```yaml
  "@statewalker/db-api": ^0.1.0
  "@statewalker/db-duckdb-node": ^0.1.0
  "@statewalker/db-pglite": ^0.1.0
```

- [ ] **Step 2: Rewrite the test wiring (failing first)**

In `packages/indexer-pglite/tests/suite.test.ts`, replace the imports of `PGlite` and the factory:

```ts
import { vector } from "@electric-sql/pglite-pgvector";
import type { Db } from "@statewalker/db-api";
import { newPgliteDb } from "@statewalker/db-pglite";
// … existing indexer-api / indexer-core / fulltext / tests / vector imports unchanged …
import { createPGLiteIndexer } from "../src/pglite-indexer.js";

const openDbs: Db[] = [];
async function newDb(): Promise<Db> {
  const db = await newPgliteDb({ extensions: { vector } });
  openDbs.push(db);
  return db;
}

const factory = {
  create: async () => createPGLiteIndexer({ db: await newDb() }),
  cleanup: async () => {
    for (const db of openDbs.splice(0)) await db.close();
  },
};
```

In the three SQL-specific `describe` blocks replace `PGlite.create({ extensions: { vector } })` with `newPgliteDb({ extensions: { vector } })`, the `let db: PGlite` declaration with `let db: Db`, and every raw read `const { rows } = await db.query<…>(sql)` with `const rows = await db.query<…>(sql)`. In the `afterEach` of "docs-table reclamation" add `await db.close();` after closing the indexer (the indexer no longer owns the database).

Add one test to the "manifest survival across reopen" describe:

```ts
  it("indexer.close() leaves the caller's Db open", async () => {
    const db = await newPgliteDb({ extensions: { vector } });
    try {
      const indexer = await createPGLiteIndexer({ db });
      await indexer.close();
      const rows = await db.query<{ one: number }>("SELECT 1 AS one");
      expect(rows[0]?.one).toBe(1);
    } finally {
      await db.close();
    }
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @statewalker/indexer-pglite test`
Expected: FAIL — type/runtime error: `createPGLiteIndexer` called with a `Db` (`db.exec(...).then` / `rows` undefined) or missing module `@statewalker/db-pglite` until the dependency is added.

- [ ] **Step 4: Implement**

`packages/indexer-pglite/src/pglite-indexer.ts`:

```ts
import type { Db } from "@statewalker/db-api";
import type { Indexer } from "@statewalker/indexer-api";
import { createSqlIndexer } from "@statewalker/indexer-core";
import { pgliteDialect } from "./dialect.js";

export interface PGLiteIndexerOptions {
  /** A PGlite-backed `Db` with the pgvector extension loaded. The indexer never closes it. */
  db: Db;
}

/**
 * PGlite-backed `Indexer` over the open-registry contract.
 *
 * Wires the per-Index docs table, per-sub-index FTS / vector tables, and the
 * `__indexer_manifest` table via `createSqlIndexer`. The FTS modality uses
 * PostgreSQL `tsvector` with GIN; the vector modality uses pgvector's
 * `vector(dim)` with HNSW, so `db` must be opened with the vector extension.
 */
export function createPGLiteIndexer(options: PGLiteIndexerOptions): Promise<Indexer> {
  return createSqlIndexer({ db: options.db, dialect: pgliteDialect });
}
```

`Db` satisfies `SqlDb` structurally (`query<T>(sql, params?) → Promise<T[]>`, `exec(sql) → Promise<void>`), so no wrapper is needed. In `src/dialect.ts` delete `wrapDbAsSqlDb` and the `import type { PGlite } …` line; remove `SqlDb` from the type import if it becomes unused.

`packages/indexer-pglite/package.json`: bump nothing by hand (changesets does it). Dependencies become:

```json
  "dependencies": {
    "@statewalker/db-api": "catalog:",
    "@statewalker/indexer-api": "workspace:^",
    "@statewalker/indexer-core": "workspace:^",
    "@statewalker/indexer-fulltext": "workspace:^",
    "@statewalker/indexer-vector": "workspace:^"
  },
  "devDependencies": {
    "@electric-sql/pglite-pgvector": "catalog:",
    "@statewalker/db-pglite": "catalog:",
    "@statewalker/indexer-tests": "workspace:^",
    "rimraf": "catalog:",
    "tsdown": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  },
```

Update `description` to `"PGlite-backed indexer implementation: full-text + vector search over a @statewalker/db-api Db."`.

Run: `pnpm install` (umbrella root).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @statewalker/indexer-pglite test && pnpm --filter @statewalker/indexer-pglite typecheck`
Expected: PASS (kernel, RRF, multi-word, multi-instance, SQL-specific scenarios, the new close test).

- [ ] **Step 6: README + changeset**

README `How to use`: replace the dependency paragraph and API bullets with:

```md
The indexer runs over a `Db` from `@statewalker/db-pglite`. Open it with the pgvector extension — the indexer issues `CREATE EXTENSION IF NOT EXISTS vector` and fails with `extension "vector" is not available` otherwise. The indexer never closes the `Db`; close it yourself.

- `createPGLiteIndexer({ db }): Promise<Indexer>` — `db: Db`.
- `PGLiteIndexerOptions` — the options type.
```

Update each example to:

```ts
import { vector } from "@electric-sql/pglite-pgvector";
import { newPgliteDb } from "@statewalker/db-pglite";
import { createPGLiteIndexer } from "@statewalker/indexer-pglite";

const db = await newPgliteDb({ extensions: { vector } });
const indexer = await createPGLiteIndexer({ db });
// …
await indexer.close();
await db.close();
```

In `Internals → Dependencies`, replace the `@electric-sql/pglite` bullet with `@statewalker/db-api` (the `Db` it runs on).

`.changeset/indexer-pglite-on-db.md`:

```md
---
"@statewalker/indexer-pglite": minor
---

`createPGLiteIndexer({ db })` now takes a `@statewalker/db-api` `Db` (from `@statewalker/db-pglite`) instead of a `PGlite`. The caller loads the vector extension and owns the database: the indexer no longer creates or closes it. Breaking.
```

- [ ] **Step 7: Lint and commit**

```bash
pnpm biome check --write --unsafe packages/indexer-pglite pnpm-workspace.yaml
git add pnpm-workspace.yaml packages/indexer-pglite .changeset/indexer-pglite-on-db.md
git commit -m "feat(indexer-pglite)!: take a db-api Db instead of a PGlite"
```

---

### Task 2: `@statewalker/indexer-ngram` contract package with `grep`

**Files:**
- Create: `packages/indexer-ngram/{package.json,tsconfig.json,tsdown.config.ts,vitest.config.ts,README.md}`
- Create: `packages/indexer-ngram/src/{types.ts,config.ts,access.ts,grep.ts,index.ts}`
- Test: `packages/indexer-ngram/tests/grep.test.ts`
- Create: `.changeset/indexer-ngram-contract.md`

**Interfaces:**
- Consumes: `@statewalker/indexer-api` (`Index`, `SearchIndex`, `ScoredHit`, `BlockReference`, `DocumentPath`, `Metadata`, `CreateIndexParams`, `SearchRequest`, `SearchResult`, `getSubQuery`, `setSubQuery`, `getSubResult`).
- Produces (exact):

```ts
export const NGRAM_TYPE = "ngram" as const;
export interface NgramBlock extends BlockReference { content: string; metadata?: Metadata }
export interface NgramQuery { pattern: string; regex?: boolean; caseSensitive?: boolean; topK?: number; paths?: DocumentPath[] }
export interface NgramMatch { start: number; end: number; line: number }
export interface NgramResult extends ScoredHit { count: number; matches: NgramMatch[] }
export interface NgramSearchSummary { truncated: boolean }
export interface NgramIndexInfo { store: "fts5" | "postings"; metadata?: Metadata }
export interface NgramIndex extends SearchIndex<NgramBlock, NgramQuery, NgramResult> {
  search(params: NgramQuery): AsyncGenerator<NgramResult, NgramSearchSummary | undefined>;
  getIndexInfo(): Promise<NgramIndexInfo>;
}
export interface NgramConfig { store?: "fts5" | "postings"; metadata?: Metadata }
export function setNgramConfig(params: CreateIndexParams, name: string, config: NgramConfig): void;
export function getNgramConfig(params: CreateIndexParams, name: string): NgramConfig | undefined;
export interface NgramAccess { name; get(index): NgramIndex; tryGet(index): NgramIndex | undefined; setConfig; getConfig; setQuery; getQuery; getResult }
export function newNgramAccess(name: string): NgramAccess;
export type GrepOptions = Omit<NgramQuery, "pattern">;
export interface GrepResult { hits: NgramResult[]; truncated: boolean }
export function grep(index: Index, name: string, pattern: string, options?: GrepOptions): Promise<GrepResult>;
```

- [ ] **Step 1: Scaffold the package**

Copy `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts` verbatim from `packages/indexer-duckdb/`. `package.json`:

```json
{
  "name": "@statewalker/indexer-ngram",
  "version": "0.0.0",
  "private": false,
  "type": "module",
  "description": "N-gram / regex (grep) modality contract for @statewalker/indexer-api: types, typed access handle and a grep helper.",
  "bugs": { "url": "https://github.com/statewalker/statewalker-search/issues" },
  "homepage": "https://github.com/statewalker/statewalker-search/tree/main/packages/indexer-ngram#readme",
  "author": { "name": "Mikhail Kotelnikov", "email": "mikhail.kotelnikov@gmail.com" },
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/statewalker/statewalker-search.git", "directory": "packages/indexer-ngram" },
  "exports": {
    ".": { "source": "./src/index.ts", "types": "./dist/index.d.ts", "import": "./dist/index.js", "default": "./dist/index.js" }
  },
  "files": ["dist", "src"],
  "scripts": {
    "build": "tsdown",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist",
    "lint": "biome check --write .",
    "format": "biome format --write ."
  },
  "dependencies": { "@statewalker/indexer-api": "workspace:^" },
  "devDependencies": { "rimraf": "catalog:", "tsdown": "catalog:", "typescript": "catalog:", "vitest": "catalog:" },
  "sideEffects": false,
  "publishConfig": { "access": "public" }
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

`packages/indexer-ngram/tests/grep.test.ts` — a real composite-less `Index` is not needed: `grep` only uses `index.getBinding(name)`, so the test builds the smallest `Index`-shaped object around a hand-written `NgramIndex` whose `search` returns a summary.

```ts
import type { AnySubIndexBinding, Index } from "@statewalker/indexer-api";
import { describe, expect, it } from "vitest";
import { grep, NGRAM_TYPE, type NgramIndex, type NgramQuery, type NgramResult } from "../src/index.js";

function indexWith(name: string, sub: Partial<NgramIndex>): Index {
  const binding = { name, type: NGRAM_TYPE, config: {}, index: sub } as unknown as AnySubIndexBinding;
  return {
    name: "idx",
    getBinding: (n: string) => (n === name ? binding : undefined),
  } as unknown as Index;
}

describe("grep", () => {
  it("collects every hit and returns the search summary's truncated flag", async () => {
    const seen: NgramQuery[] = [];
    const hit: NgramResult = { path: "/a", blockId: "b", score: 2, count: 2, matches: [] };
    const index = indexWith("g", {
      async *search(q: NgramQuery) {
        seen.push(q);
        yield hit;
        return { truncated: true };
      },
    });
    const result = await grep(index, "g", "foo", { caseSensitive: false });
    expect(result).toEqual({ hits: [hit], truncated: true });
    expect(seen).toEqual([{ caseSensitive: false, pattern: "foo" }]);
  });

  it("reports truncated: false when the index returns no summary", async () => {
    const index = indexWith("g", {
      async *search() {
        /* no hits, no summary */
      },
    });
    expect(await grep(index, "g", "x")).toEqual({ hits: [], truncated: false });
  });

  it("throws when no sub-index has that name", async () => {
    await expect(grep(indexWith("g", {}), "missing", "x")).rejects.toThrow(
      'No sub-index named "missing" is registered on index "idx"',
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @statewalker/indexer-ngram test`
Expected: FAIL — `Cannot find module '../src/index.js'`.

- [ ] **Step 4: Implement**

`src/types.ts`:

```ts
import type {
  BlockReference,
  DocumentPath,
  Metadata,
  ScoredHit,
  SearchIndex,
} from "@statewalker/indexer-api";

/** Stable modality-type discriminator for the n-gram (grep) modality. */
export const NGRAM_TYPE = "ngram" as const;

/** A block of text for the n-gram sub-index. Matches never cross block boundaries. */
export interface NgramBlock extends BlockReference {
  content: string;
  metadata?: Metadata;
}

/**
 * N-gram sub-query: an exact pattern, literal by default.
 *
 * `regex: true` reads `pattern` as a JavaScript regular expression;
 * `caseSensitive` defaults to `true` (grep semantics). `topK` (default 100)
 * caps the returned blocks; `topK` / `paths` override the top-level request
 * values for this sub-index. A backend may stop early (a candidate budget —
 * 10,000 in the SQLite backend); the search then reports `truncated: true`.
 */
export interface NgramQuery {
  pattern: string;
  regex?: boolean;
  caseSensitive?: boolean;
  topK?: number;
  paths?: DocumentPath[];
}

/** One match: UTF-16 offsets into the block's content, `end` exclusive; `line` is 1-based. */
export interface NgramMatch {
  start: number;
  end: number;
  line: number;
}

/** A block with at least one match. `score` equals `count`. */
export interface NgramResult extends ScoredHit {
  count: number;
  matches: NgramMatch[];
}

/** Returned by `NgramIndex.search` when the generator finishes. */
export interface NgramSearchSummary {
  /** `true` when the candidate budget cut verification short — results may be incomplete. */
  truncated: boolean;
}

export interface NgramIndexInfo {
  store: "fts5" | "postings";
  metadata?: Metadata;
}

/**
 * N-gram / regex sub-index. `search` yields hits and *returns* a summary;
 * `for await` drops the summary — use {@link grep} to read it.
 */
export interface NgramIndex extends SearchIndex<NgramBlock, NgramQuery, NgramResult> {
  search(params: NgramQuery): AsyncGenerator<NgramResult, NgramSearchSummary | undefined>;
  getIndexInfo(): Promise<NgramIndexInfo>;
}

/** Creation config. `store` picks the backend's candidate store; backends choose the default. */
export interface NgramConfig {
  store?: "fts5" | "postings";
  metadata?: Metadata;
}
```

`src/config.ts`:

```ts
import type { CreateIndexParams } from "@statewalker/indexer-api";
import { NGRAM_TYPE, type NgramConfig } from "./types.js";

/** Write an n-gram config for the sub-index named `name` into `params.subIndexes`. */
export function setNgramConfig(params: CreateIndexParams, name: string, config: NgramConfig): void {
  if (!params.subIndexes) params.subIndexes = {};
  params.subIndexes[name] = { type: NGRAM_TYPE, ...config };
}

/** Read the n-gram config for the sub-index named `name`, if any. */
export function getNgramConfig(params: CreateIndexParams, name: string): NgramConfig | undefined {
  const entry = params.subIndexes?.[name];
  if (!entry || entry.type !== NGRAM_TYPE) return undefined;
  const { type: _type, ...rest } = entry;
  return rest as NgramConfig;
}
```

`src/access.ts`:

```ts
import type { CreateIndexParams, Index, SearchRequest, SearchResult } from "@statewalker/indexer-api";
import { getSubQuery, getSubResult, setSubQuery } from "@statewalker/indexer-api";
import { getNgramConfig, setNgramConfig } from "./config.js";
import type { NgramConfig, NgramIndex, NgramQuery, NgramResult } from "./types.js";

/** User-facing typed bundle bound to one n-gram sub-index **name**. */
export interface NgramAccess {
  readonly name: string;
  /** Throws if no sub-index named `name` is registered on `index`. */
  get(index: Index): NgramIndex;
  tryGet(index: Index): NgramIndex | undefined;
  setConfig(params: CreateIndexParams, config: NgramConfig): void;
  getConfig(params: CreateIndexParams): NgramConfig | undefined;
  setQuery(request: SearchRequest, query: NgramQuery): void;
  getQuery(request: SearchRequest): NgramQuery | undefined;
  getResult(entry: SearchResult): NgramResult | undefined;
}

export function newNgramAccess(name: string): NgramAccess {
  return {
    name,
    get(index: Index): NgramIndex {
      const binding = index.getBinding(name);
      if (!binding) {
        throw new Error(`No sub-index named "${name}" is registered on index "${index.name}"`);
      }
      return binding.index as NgramIndex;
    },
    tryGet: (index) => index.getBinding(name)?.index as NgramIndex | undefined,
    setConfig: (params, config) => setNgramConfig(params, name, config),
    getConfig: (params) => getNgramConfig(params, name),
    setQuery: (request, query) => setSubQuery<NgramQuery>(request, name, query),
    getQuery: (request) => getSubQuery<NgramQuery>(request, name),
    getResult: (entry) => getSubResult<NgramResult>(entry, name),
  };
}
```

`src/grep.ts`:

```ts
import type { Index } from "@statewalker/indexer-api";
import { newNgramAccess } from "./access.js";
import type { NgramQuery, NgramResult } from "./types.js";

export type GrepOptions = Omit<NgramQuery, "pattern">;

export interface GrepResult {
  hits: NgramResult[];
  /** `true` when the backend stopped verifying candidates early; `hits` may be incomplete. */
  truncated: boolean;
}

/** Run `pattern` on the n-gram sub-index `name` of `index` and collect every hit plus the truncation flag. */
export async function grep(
  index: Index,
  name: string,
  pattern: string,
  options: GrepOptions = {},
): Promise<GrepResult> {
  const it = newNgramAccess(name).get(index).search({ ...options, pattern });
  const hits: NgramResult[] = [];
  for (;;) {
    const step = await it.next();
    if (step.done) return { hits, truncated: step.value?.truncated ?? false };
    hits.push(step.value);
  }
}
```

`src/index.ts`:

```ts
export { newNgramAccess, type NgramAccess } from "./access.js";
export { getNgramConfig, setNgramConfig } from "./config.js";
export { type GrepOptions, type GrepResult, grep } from "./grep.js";
export {
  NGRAM_TYPE,
  type NgramBlock,
  type NgramConfig,
  type NgramIndex,
  type NgramIndexInfo,
  type NgramMatch,
  type NgramQuery,
  type NgramResult,
  type NgramSearchSummary,
} from "./types.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @statewalker/indexer-ngram test && pnpm --filter @statewalker/indexer-ngram typecheck`
Expected: PASS (3 tests).

- [ ] **Step 6: README + changeset**

`packages/indexer-ngram/README.md` (package shape): *What it is* — the n-gram/regex modality contract for `indexer-api`; *Why it exists* — full-text search drops punctuation and stems words, so it cannot find `fooBar(`, `TODO:` or a regex; grep needs an exact-match modality with match offsets, and backends (SQLite today) implement it; *How to use* — `setNgramConfig`, `newNgramAccess(name).get(index).addDocument`, `grep(index, name, pattern, opts)`; *Examples* — config + ingest + `grep` + a fused `SearchRequest` with `setQuery`; *Internals* — score = match count, matches never cross blocks, `caseSensitive` defaults to `true`, offsets are UTF-16 code units with `end` exclusive, the summary travels as the generator's return value so `for await` cannot see `truncated` (failure mode: "a `for await` over `search` silently ignores truncation; use `grep`"), zero runtime dependencies beyond `indexer-api`; *License* — MIT.

`.changeset/indexer-ngram-contract.md`:

```md
---
"@statewalker/indexer-ngram": minor
---

New n-gram / regex modality contract: `NGRAM_TYPE`, block/query/result types, `newNgramAccess`, config helpers and `grep(index, name, pattern, opts)`.
```

- [ ] **Step 7: Lint and commit**

```bash
pnpm biome check --write --unsafe packages/indexer-ngram
git add packages/indexer-ngram .changeset/indexer-ngram-contract.md pnpm-lock.yaml
git commit -m "feat(indexer-ngram): n-gram modality contract with grep helper"
```

---

### Task 3: `indexer-sqlite` kernel — provider contract, blocks table, manifest

**Files:**
- Modify: `pnpm-workspace.yaml` (catalog)
- Create: `packages/indexer-sqlite/{package.json,tsconfig.json,tsdown.config.ts,vitest.config.ts}`
- Create: `packages/indexer-sqlite/src/{types.ts,path-sql.ts,block-ids.ts,enumeration.ts,create-sqlite-indexer.ts,index.ts}`
- Create: `packages/indexer-sqlite/tests/support/dbs.ts`
- Test: `packages/indexer-sqlite/tests/kernel.test.ts`

**Interfaces:**
- Consumes: `Db` (db-api); `inTransaction` (db-sqlite, used from Task 4 on); `newNodeSqliteDb`, `newDoSqliteDb`, `newFakeDoStorage` (P1, tests only); `createCompositeIndex`, `createSerialiser`, `sanitizePrefix`, `compositeKey` from `@statewalker/indexer-core`.
- Produces (exact):

```ts
// src/types.ts
export interface SqliteModalityContext {
  /** The database. Use it directly, or as `tx` inside `inTransaction`. */
  db: Db;
  /** Unique table-name prefix for this sub-index, e.g. `idx_docs__body_`. */
  prefix: string;
  /** The Index's shared block-id table. */
  blockIds: BlockIds;
}
export interface SqliteModalityProvider<C = unknown, I extends SearchIndex<unknown, unknown, ScoredHit> = SearchIndex<unknown, unknown, ScoredHit>> {
  readonly type: string;
  /** Create tables if missing and return the sub-index. Idempotent: reopening sees existing data. */
  open(ctx: SqliteModalityContext, config: C): Promise<I>;
  /** Drop every table this provider owns under `ctx.prefix`. Safe when nothing exists. */
  drop(ctx: SqliteModalityContext): Promise<void>;
}
// src/block-ids.ts
export interface BlockIds {
  readonly table: string;
  ensure(db: Db, refs: readonly BlockReference[]): Promise<number[]>;
  select(db: Db, selectors: readonly PathSelector[]): Promise<number[]>;
  refs(db: Db, ids: readonly number[]): Promise<Map<number, BlockReference>>;
}
export function openBlockIds(db: Db, table: string): Promise<BlockIds>;
// src/path-sql.ts
export function pathPrefixSql(column: string, prefixes: readonly string[]): { sql: string; params: string[] };
// src/enumeration.ts
export interface BlockEntry extends BlockReference { id: number }
export interface Enumeration {
  size(prefix?: DocumentPath): Promise<number>;
  entries(prefix?: DocumentPath): Promise<BlockEntry[]>;
  paths(prefix?: DocumentPath): AsyncGenerator<DocumentPath>;
  refs(prefix?: DocumentPath): AsyncGenerator<BlockReference>;
}
export function newEnumeration(db: Db, blockIds: BlockIds, memberIdsSql: string): Enumeration;
// src/create-sqlite-indexer.ts
export interface SqliteIndexerOptions { db: Db; providers: SqliteModalityProvider[] }
export function createSqliteIndexer(options: SqliteIndexerOptions): Promise<Indexer>;
```

Table naming: Index `N` → index prefix `idx_${sanitizePrefix(N)}__`; blocks table `${indexPrefix}blocks`; sub-index `S` → `ctx.prefix = ${indexPrefix}${sanitizePrefix(S)}_`. `sanitizePrefix` encodes `_` as `_95_`, so `__` never appears inside an encoded name and prefixes cannot collide.

- [ ] **Step 1: Scaffold the package**

Copy `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts` from `packages/indexer-duckdb/`. Add to `pnpm-workspace.yaml` `catalog:`:

```yaml
  "@statewalker/db-sqlite": ^0.1.0
  "@statewalker/db-sqlite-do": ^0.1.0
  "@statewalker/db-sqlite-index": ^0.1.0
  "@statewalker/db-sqlite-node": ^0.3.0
```

`packages/indexer-sqlite/package.json`:

```json
{
  "name": "@statewalker/indexer-sqlite",
  "version": "0.0.0",
  "private": false,
  "type": "module",
  "description": "SQLite-backed indexer: FTS5, vector and n-gram/grep sub-indexes in one @statewalker/db-api Db (Node, browser worker, Durable Objects).",
  "bugs": { "url": "https://github.com/statewalker/statewalker-search/issues" },
  "homepage": "https://github.com/statewalker/statewalker-search/tree/main/packages/indexer-sqlite#readme",
  "author": { "name": "Mikhail Kotelnikov", "email": "mikhail.kotelnikov@gmail.com" },
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/statewalker/statewalker-search.git", "directory": "packages/indexer-sqlite" },
  "exports": {
    ".": { "source": "./src/index.ts", "types": "./dist/index.d.ts", "import": "./dist/index.js", "default": "./dist/index.js" }
  },
  "files": ["dist", "src"],
  "scripts": {
    "build": "tsdown",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist",
    "lint": "biome check --write .",
    "format": "biome format --write ."
  },
  "dependencies": {
    "@statewalker/db-api": "catalog:",
    "@statewalker/db-sqlite": "catalog:",
    "@statewalker/indexer-api": "workspace:^",
    "@statewalker/indexer-core": "workspace:^"
  },
  "devDependencies": {
    "@statewalker/db-sqlite-do": "catalog:",
    "@statewalker/db-sqlite-node": "catalog:",
    "@statewalker/indexer-tests": "workspace:^",
    "rimraf": "catalog:",
    "tsdown": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  },
  "sideEffects": false,
  "publishConfig": { "access": "public" }
}
```

(Tasks 4–6 add `indexer-fulltext`, `indexer-vector`, `indexer-ngram`, `db-sqlite-index` when their provider lands.)

Run: `pnpm install`

- [ ] **Step 2: Test support — two Db flavours and a reopenable factory**

`tests/support/dbs.ts`:

```ts
import type { Db } from "@statewalker/db-api";
import { newDoSqliteDb } from "@statewalker/db-sqlite-do";
import { newFakeDoStorage } from "@statewalker/db-sqlite-do/fake";
import { newNodeSqliteDb } from "@statewalker/db-sqlite-node";
import type { IndexerPersistence } from "@statewalker/indexer-api";
import type { IndexerFactory } from "@statewalker/indexer-tests";
import { createSqliteIndexer, type SqliteModalityProvider } from "../../src/index.js";

export interface DbFlavour {
  name: string;
  open(): Promise<Db>;
}

/** Every suite runs on both: node:sqlite in memory, and the fake DO storage (no BEGIN, ArrayBuffer blobs). */
export const flavours: DbFlavour[] = [
  { name: "node:sqlite", open: () => newNodeSqliteDb() },
  { name: "do (fake storage)", open: async () => newDoSqliteDb(newFakeDoStorage()) },
];

/**
 * `IndexerFactory` for the shared suites. The kernel suite's "persistence" is
 * the database itself: `createWithPersistence(p)` reuses one `Db` per `p`, so
 * the second indexer reopens what the first one wrote.
 */
export function indexerFactory(
  flavour: DbFlavour,
  providers: () => SqliteModalityProvider[],
): IndexerFactory {
  const dbs = new WeakMap<IndexerPersistence, Db>();
  return {
    create: async () => createSqliteIndexer({ db: await flavour.open(), providers: providers() }),
    createWithPersistence: async (persistence) => {
      let db = dbs.get(persistence);
      if (!db) {
        db = await flavour.open();
        dbs.set(persistence, db);
      }
      return createSqliteIndexer({ db, providers: providers() });
    },
  };
}
```

- [ ] **Step 3: Write the failing kernel test**

The kernel is exercised through a real but tiny provider defined in the test (a collaborator, not the code under test): it stores block ids in one table, which also proves `ctx.prefix`, `ctx.blockIds`, `open` on reopen and `drop`.

`tests/kernel.test.ts`:

```ts
import type { Db } from "@statewalker/db-api";
import type { BlockReference, Index, ScoredHit, SearchIndex } from "@statewalker/indexer-api";
import { collect } from "@statewalker/indexer-tests";
import { describe, expect, it } from "vitest";
import {
  createSqliteIndexer,
  newEnumeration,
  pathPrefixSql,
  type SqliteModalityProvider,
} from "../src/index.js";
import { flavours } from "./support/dbs.js";

type Tag = BlockReference & { tag: string };

/** Minimal provider: one `{prefix}tags(id PRIMARY KEY, tag)` table; search = exact tag. */
function tagProvider(type = "tag"): SqliteModalityProvider<{ label: string }, SearchIndex<Tag, string, ScoredHit>> {
  return {
    type,
    async open({ db, prefix, blockIds }) {
      const table = `${prefix}tags`;
      await db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY, tag TEXT NOT NULL)`);
      const list = newEnumeration(db, blockIds, `SELECT id FROM ${table}`);
      return {
        async *search(tag: string) {
          const rows = await db.query<{ id: number }>(`SELECT id FROM ${table} WHERE tag = ?`, [tag]);
          const refs = await blockIds.refs(db, rows.map((r) => Number(r.id)));
          for (const ref of refs.values()) yield { ...ref, score: 1 };
        },
        async addDocument(blocks: Tag[]) {
          const ids = await blockIds.ensure(db, blocks);
          for (const [i, id] of ids.entries()) {
            await db.query(`INSERT OR REPLACE INTO ${table} (id, tag) VALUES (?, ?)`, [id, blocks[i]?.tag]);
          }
        },
        async addDocuments(batches) {
          for await (const b of batches) await this.addDocument(b);
        },
        async deleteDocuments(selectors) {
          const sels = [];
          for await (const s of selectors) sels.push(s);
          const ids = await blockIds.select(db, sels);
          await db.query(`DELETE FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`, [JSON.stringify(ids)]);
        },
        getSize: (p) => list.size(p),
        getDocumentPaths: (p) => list.paths(p),
        getDocumentBlocksRefs: (p) => list.refs(p),
        async *getDocumentsBlocks() {},
        async close() {},
        async flush() {},
        async deleteIndex() {
          await db.exec(`DROP TABLE IF EXISTS ${table}`);
        },
      };
    },
    async drop({ db, prefix }) {
      await db.exec(`DROP TABLE IF EXISTS ${prefix}tags`);
    },
  };
}

async function tables(db: Db): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    // `_cf_*` are the Durable Object runtime's own tables.
    "SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 4) <> '_cf_' ORDER BY name",
  );
  return rows.map((r) => r.name);
}

for (const flavour of flavours) {
  describe(`indexer-sqlite kernel — ${flavour.name}`, () => {
    it("creates the manifest, a blocks table per Index and one prefix per sub-index", async () => {
      const db = await flavour.open();
      const indexer = await createSqliteIndexer({ db, providers: [tagProvider()] });
      await indexer.createIndex({ name: "docs", subIndexes: { a: { type: "tag", label: "x" } } });
      expect(await tables(db)).toEqual(
        expect.arrayContaining(["__indexer_manifest", "idx_docs__blocks", "idx_docs__a_tags"]),
      );
    });

    it("a reopened indexer adopts the saved index and its data", async () => {
      const db = await flavour.open();
      const first = await createSqliteIndexer({ db, providers: [tagProvider()] });
      const idx = await first.createIndex({ name: "docs", subIndexes: { a: { type: "tag", label: "x" } } });
      await (idx.getBinding("a")?.index as SearchIndex<Tag, string, ScoredHit>).addDocument([
        { path: "/d/1", blockId: "b1", tag: "red" },
      ]);
      await first.close();

      const second = await createSqliteIndexer({ db, providers: [tagProvider()] });
      const reopened = (await second.getIndex("docs")) as Index;
      const hits = await collect(reopened.search({ topK: 5, subQueries: { a: "red" } }));
      expect(hits.map((h) => [h.path, h.blockId])).toEqual([["/d/1", "b1"]]);
    });

    it("a saved type without a provider throws by default and is skipped under 'warn'", async () => {
      const db = await flavour.open();
      const first = await createSqliteIndexer({ db, providers: [tagProvider(), tagProvider("other")] });
      await first.createIndex({
        name: "docs",
        subIndexes: { a: { type: "tag", label: "x" }, b: { type: "other", label: "y" } },
      });
      await first.close();

      const strict = await createSqliteIndexer({ db, providers: [tagProvider()] });
      await expect(strict.getIndex("docs")).rejects.toThrow(
        'sub-index "b" requires modality "other"',
      );
      const lenient = await createSqliteIndexer({ db, providers: [tagProvider()] });
      const idx = await lenient.getIndex("docs", { onMissingProvider: "warn" });
      expect(idx?.getBinding("a")).toBeDefined();
      expect(idx?.getBinding("b")).toBeUndefined();
    });

    it("deleteIndex drops every table of the index and its manifest row", async () => {
      const db = await flavour.open();
      const indexer = await createSqliteIndexer({ db, providers: [tagProvider()] });
      await indexer.createIndex({ name: "docs", subIndexes: { a: { type: "tag", label: "x" } } });
      await indexer.deleteIndex("docs");
      expect(await tables(db)).toEqual(["__indexer_manifest"]);
      expect(await indexer.hasIndex("docs")).toBe(false);
    });

    it("reinit drops the old sub-index tables before reopening with the new config", async () => {
      const db = await flavour.open();
      const first = await createSqliteIndexer({ db, providers: [tagProvider()] });
      const idx = await first.createIndex({ name: "docs", subIndexes: { a: { type: "tag", label: "x" } } });
      await (idx.getBinding("a")?.index as SearchIndex<Tag, string, ScoredHit>).addDocument([
        { path: "/d/1", blockId: "b1", tag: "red" },
      ]);
      await first.close();
      const second = await createSqliteIndexer({ db, providers: [tagProvider()] });
      const re = await second.getIndex("docs", { subIndexes: { a: { type: "tag", label: "z" } } });
      expect(await re?.getBinding("a")?.index.getSize()).toBe(0);
    });
  });
}

describe("pathPrefixSql", () => {
  it("matches path-component boundaries, case-sensitively", async () => {
    const db = await flavours[0]!.open();
    await db.exec("CREATE TABLE p (path TEXT)");
    for (const path of ["/docs/a", "/Docs/b", "/foo", "/foo/x", "/foobar"]) {
      await db.query("INSERT INTO p VALUES (?)", [path]);
    }
    const run = async (prefixes: string[]) => {
      const c = pathPrefixSql("path", prefixes);
      const rows = await db.query<{ path: string }>(`SELECT path FROM p WHERE ${c.sql} ORDER BY path`, c.params);
      return rows.map((r) => r.path);
    };
    expect(await run(["/docs"])).toEqual(["/docs/a"]);
    expect(await run(["/foo"])).toEqual(["/foo", "/foo/x"]);
    expect(await run(["/foo/"])).toEqual(["/foo/x"]);
    expect(await run([])).toEqual(["/Docs/b", "/docs/a", "/foo", "/foo/x", "/foobar"]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @statewalker/indexer-sqlite test`
Expected: FAIL — `Cannot find module '../src/index.js'`.

- [ ] **Step 5: Implement `path-sql.ts`, `block-ids.ts`, `enumeration.ts`, `types.ts`**

`src/path-sql.ts`:

```ts
/**
 * SQL condition matching `column` under any of `prefixes`, on path-component
 * boundaries (`/foo` matches `/foo` and `/foo/x`, never `/foobar`) and
 * case-sensitively. Uses `substr` rather than `LIKE`: SQLite's `LIKE` ignores
 * ASCII case, and `PRAGMA case_sensitive_like` is not authorised in Durable
 * Objects. No prefixes → `1` (no constraint).
 */
export function pathPrefixSql(
  column: string,
  prefixes: readonly string[],
): { sql: string; params: string[] } {
  if (prefixes.length === 0) return { sql: "1", params: [] };
  const parts: string[] = [];
  const params: string[] = [];
  for (const prefix of prefixes) {
    if (prefix.endsWith("/")) {
      parts.push(`substr(${column}, 1, length(?)) = ?`);
      params.push(prefix, prefix);
    } else {
      parts.push(`(${column} = ? OR substr(${column}, 1, length(?)) = ?)`);
      params.push(prefix, `${prefix}/`, `${prefix}/`);
    }
  }
  return { sql: `(${parts.join(" OR ")})`, params };
}
```

`src/block-ids.ts`:

```ts
import type { Db } from "@statewalker/db-api";
import type { BlockReference, DocumentPath, PathSelector } from "@statewalker/indexer-api";
import { compositeKey } from "@statewalker/indexer-core";
import { pathPrefixSql } from "./path-sql.js";

/**
 * The Index-wide `{path, blockId} ↔ integer id` table shared by every sub-index.
 * Every method takes the `Db` to run on, so it works on `tx` inside `inTransaction`.
 * Rows are never deleted before `deleteIndex`: an id stays stable for its block.
 */
export interface BlockIds {
  readonly table: string;
  /** Ids for `refs`, in order; missing rows are created. */
  ensure(db: Db, refs: readonly BlockReference[]): Promise<number[]>;
  /** Ids of every known block matched by any selector (path prefix, or exact block). */
  select(db: Db, selectors: readonly PathSelector[]): Promise<number[]>;
  /** References of `ids`; unknown ids are absent. */
  refs(db: Db, ids: readonly number[]): Promise<Map<number, BlockReference>>;
}

export async function openBlockIds(db: Db, table: string): Promise<BlockIds> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY, path TEXT NOT NULL, block_id TEXT NOT NULL, UNIQUE (path, block_id))`,
  );
  return {
    table,
    async ensure(tx, refs) {
      if (refs.length === 0) return [];
      const json = JSON.stringify(refs.map((r) => [r.path, r.blockId]));
      // `WHERE true` disambiguates `SELECT … ON CONFLICT` for the SQLite parser.
      await tx.query(
        `INSERT INTO ${table} (path, block_id) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?) WHERE true ON CONFLICT (path, block_id) DO NOTHING`,
        [json],
      );
      const rows = await tx.query<{ id: number; path: string; block_id: string }>(
        `SELECT b.id, b.path, b.block_id FROM ${table} b JOIN json_each(?) j ON b.path = json_extract(j.value, '$[0]') AND b.block_id = json_extract(j.value, '$[1]')`,
        [json],
      );
      const byKey = new Map(
        rows.map((r) => [compositeKey(r.path as DocumentPath, r.block_id), Number(r.id)]),
      );
      return refs.map((r) => {
        const id = byKey.get(compositeKey(r.path, r.blockId));
        if (id === undefined) throw new Error(`block id missing for ${r.path}#${r.blockId}`);
        return id;
      });
    },
    async select(tx, selectors) {
      const ids = new Set<number>();
      for (const sel of selectors) {
        const where =
          sel.blockId !== undefined
            ? { sql: "path = ? AND block_id = ?", params: [sel.path, sel.blockId] }
            : pathPrefixSql("path", [sel.path]);
        const rows = await tx.query<{ id: number }>(`SELECT id FROM ${table} WHERE ${where.sql}`, where.params);
        for (const r of rows) ids.add(Number(r.id));
      }
      return [...ids];
    },
    async refs(tx, ids) {
      const out = new Map<number, BlockReference>();
      if (ids.length === 0) return out;
      const rows = await tx.query<{ id: number; path: string; block_id: string }>(
        `SELECT id, path, block_id FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`,
        [JSON.stringify(ids)],
      );
      for (const r of rows) out.set(Number(r.id), { path: r.path as DocumentPath, blockId: r.block_id });
      return out;
    },
  };
}
```

`src/enumeration.ts`:

```ts
import type { Db } from "@statewalker/db-api";
import type { BlockReference, DocumentPath } from "@statewalker/indexer-api";
import type { BlockIds } from "./block-ids.js";
import { pathPrefixSql } from "./path-sql.js";

export interface BlockEntry extends BlockReference {
  id: number;
}

/** `SearchIndex` enumeration over a sub-index's member ids joined with the blocks table. */
export interface Enumeration {
  size(prefix?: DocumentPath): Promise<number>;
  entries(prefix?: DocumentPath): Promise<BlockEntry[]>;
  paths(prefix?: DocumentPath): AsyncGenerator<DocumentPath>;
  refs(prefix?: DocumentPath): AsyncGenerator<BlockReference>;
}

/** `memberIdsSql` is a `SELECT … AS id` listing the sub-index's ids, e.g. `SELECT rowid AS id FROM t`. */
export function newEnumeration(db: Db, blockIds: BlockIds, memberIdsSql: string): Enumeration {
  const from = (prefix?: DocumentPath) => {
    const scope = pathPrefixSql("b.path", prefix ? [prefix] : []);
    return {
      sql: `FROM (${memberIdsSql}) m JOIN ${blockIds.table} b ON b.id = m.id WHERE ${scope.sql}`,
      params: scope.params,
    };
  };
  return {
    async size(prefix) {
      const f = from(prefix);
      const rows = await db.query<{ n: number }>(`SELECT COUNT(*) AS n ${f.sql}`, f.params);
      return Number(rows[0]?.n ?? 0);
    },
    async entries(prefix) {
      const f = from(prefix);
      const rows = await db.query<{ id: number; path: string; block_id: string }>(
        `SELECT b.id, b.path, b.block_id ${f.sql} ORDER BY b.id`,
        f.params,
      );
      return rows.map((r) => ({ id: Number(r.id), path: r.path as DocumentPath, blockId: r.block_id }));
    },
    async *paths(prefix) {
      const f = from(prefix);
      const rows = await db.query<{ path: string }>(`SELECT DISTINCT b.path ${f.sql}`, f.params);
      for (const r of rows) yield r.path as DocumentPath;
    },
    async *refs(prefix) {
      for (const e of await this.entries(prefix)) yield { path: e.path, blockId: e.blockId };
    },
  };
}
```

`src/types.ts`:

```ts
import type { Db } from "@statewalker/db-api";
import type { ScoredHit, SearchIndex } from "@statewalker/indexer-api";
import type { BlockIds } from "./block-ids.js";

export interface SqliteModalityContext {
  /** The database. Inside `inTransaction(db, (tx) => …)` use `tx` and `ctx.blockIds` methods with `tx`. */
  db: Db;
  /** Unique table-name prefix for this sub-index, e.g. `idx_docs__body_`. */
  prefix: string;
  /** The Index's shared block-id table. */
  blockIds: BlockIds;
}

/**
 * A modality backed by tables in one SQLite `Db`. Unlike `ModalityProvider`,
 * opening is async (tables are created, existing data is adopted) and the
 * provider can drop its tables without an open instance.
 */
export interface SqliteModalityProvider<
  C = unknown,
  I extends SearchIndex<unknown, unknown, ScoredHit> = SearchIndex<unknown, unknown, ScoredHit>,
> {
  readonly type: string;
  open(ctx: SqliteModalityContext, config: C): Promise<I>;
  drop(ctx: SqliteModalityContext): Promise<void>;
}
```

- [ ] **Step 6: Implement the kernel**

`src/create-sqlite-indexer.ts`:

```ts
import type { Db } from "@statewalker/db-api";
import type {
  AnySubIndexBinding,
  CreateIndexParams,
  GetIndexOptions,
  Index,
  Indexer,
  IndexInfo,
} from "@statewalker/indexer-api";
import { createCompositeIndex, createSerialiser, sanitizePrefix } from "@statewalker/indexer-core";
import { type BlockIds, openBlockIds } from "./block-ids.js";
import type { SqliteModalityContext, SqliteModalityProvider } from "./types.js";

export interface SqliteIndexerOptions {
  /** The database. The indexer never closes it. */
  db: Db;
  /** One provider per modality type, e.g. FTS5, vector, n-gram. */
  providers: SqliteModalityProvider[];
}

type SubSpec = { type: string } & Record<string, unknown>;
interface IndexManifest {
  subIndexes: Record<string, SubSpec>;
}

const MANIFEST_TABLE = "__indexer_manifest";

const indexPrefix = (name: string) => `idx_${sanitizePrefix(name)}__`;

/**
 * `Indexer` over one SQLite `Db`. Keeps a manifest row per Index, one shared
 * `{indexPrefix}blocks` id table per Index, and opens each sub-index through
 * its provider. Search fuses sub-indexes by RRF (`createCompositeIndex`).
 */
export async function createSqliteIndexer(options: SqliteIndexerOptions): Promise<Indexer> {
  const { db } = options;
  const providers = new Map(options.providers.map((p) => [p.type, p]));
  const indexes = new Map<string, Index>();
  const manifest = new Map<string, IndexManifest>();
  const runExclusive = createSerialiser();
  let closed = false;

  await db.exec(
    `CREATE TABLE IF NOT EXISTS ${MANIFEST_TABLE} (name TEXT PRIMARY KEY, config TEXT NOT NULL)`,
  );
  for (const row of await db.query<{ name: string; config: string }>(
    `SELECT name, config FROM ${MANIFEST_TABLE}`,
  )) {
    manifest.set(row.name, JSON.parse(row.config) as IndexManifest);
  }

  const ensureOpen = () => {
    if (closed) throw new Error("Indexer is closed");
  };

  const contextFor = (name: string, sub: string, blockIds: BlockIds): SqliteModalityContext => ({
    db,
    prefix: `${indexPrefix(name)}${sanitizePrefix(sub)}_`,
    blockIds,
  });

  async function writeManifest(name: string, entry: IndexManifest): Promise<void> {
    await db.query(
      `INSERT INTO ${MANIFEST_TABLE} (name, config) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET config = excluded.config`,
      [name, JSON.stringify(entry)],
    );
    manifest.set(name, entry);
  }

  async function dropIndexTables(name: string, subIndexes: Record<string, SubSpec>): Promise<void> {
    const blockIds = await openBlockIds(db, `${indexPrefix(name)}blocks`);
    for (const [sub, spec] of Object.entries(subIndexes)) {
      await providers.get(spec.type)?.drop(contextFor(name, sub, blockIds));
    }
    await db.exec(`DROP TABLE IF EXISTS ${blockIds.table}`);
    await db.query(`DELETE FROM ${MANIFEST_TABLE} WHERE name = ?`, [name]);
    manifest.delete(name);
  }

  async function openIndex(
    name: string,
    subIndexes: Record<string, SubSpec>,
    options?: GetIndexOptions,
  ): Promise<{ index: Index; effective: Record<string, SubSpec> }> {
    const onMissing = options?.onMissingProvider ?? "throw";
    const blockIds = await openBlockIds(db, `${indexPrefix(name)}blocks`);
    const bindings: AnySubIndexBinding[] = [];
    const effective: Record<string, SubSpec> = {};

    for (const [sub, saved] of Object.entries(subIndexes)) {
      const action = options?.subIndexes?.[sub];
      if (action && "skip" in action && action.skip === true) {
        effective[sub] = saved;
        continue;
      }
      const ctx = contextFor(name, sub, blockIds);
      const spec = action && !("skip" in action) ? (action as SubSpec) : saved;
      if (spec !== saved) await providers.get(saved.type)?.drop(ctx);

      const provider = providers.get(spec.type);
      if (!provider) {
        if (onMissing === "throw") {
          throw new Error(
            `Cannot load index: sub-index "${sub}" requires modality "${spec.type}" but only [${[
              ...providers.keys(),
            ]
              .map((t) => `"${t}"`)
              .join(", ")}] are registered.`,
          );
        }
        const g = globalThis as { console?: { warn(...args: unknown[]): void } };
        g.console?.warn(`Sub-index "${sub}" (type "${spec.type}") has no provider; skipping.`);
        effective[sub] = saved;
        continue;
      }
      const { type, ...config } = spec;
      bindings.push({ name: sub, type, config, index: await provider.open(ctx, config) });
      effective[sub] = spec;
    }

    const index = createCompositeIndex({
      name,
      bindings,
      onDeleteIndex: async () => {
        await db.exec(`DROP TABLE IF EXISTS ${blockIds.table}`);
        await db.query(`DELETE FROM ${MANIFEST_TABLE} WHERE name = ?`, [name]);
        manifest.delete(name);
        indexes.delete(name);
      },
    });
    return { index, effective };
  }

  return {
    async getIndexNames(): Promise<IndexInfo[]> {
      ensureOpen();
      return [...manifest.keys()].map((name) => ({ name }));
    },

    createIndex(params: CreateIndexParams): Promise<Index> {
      return runExclusive(async () => {
        ensureOpen();
        const { name, subIndexes, overwrite, metadata } = params;
        if (!subIndexes || Object.keys(subIndexes).length === 0) {
          throw new Error("Cannot create index without any subIndexes");
        }
        const existing = manifest.get(name);
        if (existing || indexes.has(name)) {
          if (!overwrite) throw new Error(`Index "${name}" already exists`);
          await indexes.get(name)?.close().catch(() => undefined);
          indexes.delete(name);
          await dropIndexTables(name, existing?.subIndexes ?? {});
        }
        const { index, effective } = await openIndex(name, subIndexes);
        await writeManifest(name, { subIndexes: effective });
        if (metadata !== undefined) (index as { metadata?: unknown }).metadata = metadata;
        indexes.set(name, index);
        return index;
      });
    },

    async getIndex(name: string, options?: GetIndexOptions): Promise<Index | null> {
      ensureOpen();
      const cached = indexes.get(name);
      if (cached) return cached;
      const entry = manifest.get(name);
      if (!entry) return null;
      const { index, effective } = await openIndex(name, entry.subIndexes, options);
      if (JSON.stringify(effective) !== JSON.stringify(entry.subIndexes)) {
        await writeManifest(name, { subIndexes: effective });
      }
      indexes.set(name, index);
      return index;
    },

    async hasIndex(name: string): Promise<boolean> {
      ensureOpen();
      return manifest.has(name);
    },

    async deleteIndex(name: string): Promise<void> {
      ensureOpen();
      const live = indexes.get(name);
      if (live) {
        await live.deleteIndex();
        return;
      }
      const entry = manifest.get(name);
      if (entry) await dropIndexTables(name, entry.subIndexes);
    },

    async flush(): Promise<void> {
      ensureOpen();
      for (const index of indexes.values()) await index.flush();
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const index of indexes.values()) await index.close().catch(() => undefined);
      indexes.clear();
    },
  } satisfies Indexer;
}
```

`src/index.ts`:

```ts
export type { BlockIds } from "./block-ids.js";
export { openBlockIds } from "./block-ids.js";
export { createSqliteIndexer, type SqliteIndexerOptions } from "./create-sqlite-indexer.js";
export { type BlockEntry, type Enumeration, newEnumeration } from "./enumeration.js";
export { pathPrefixSql } from "./path-sql.js";
export type { SqliteModalityContext, SqliteModalityProvider } from "./types.js";
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @statewalker/indexer-sqlite test && pnpm --filter @statewalker/indexer-sqlite typecheck`
Expected: PASS — 5 kernel cases × 2 flavours + `pathPrefixSql`.

- [ ] **Step 8: Lint and commit** (README + changeset land in Task 6 when the package is usable end to end; the package is `0.0.0` and unpublished until then)

```bash
pnpm biome check --write --unsafe packages/indexer-sqlite pnpm-workspace.yaml
git add packages/indexer-sqlite pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(indexer-sqlite): kernel with provider contract, shared block ids and manifest"
```

---

### Task 4: FTS5 provider

**Files:**
- Create: `packages/indexer-sqlite/src/fts-provider.ts`
- Create: `packages/indexer-sqlite/tests/support/as-modality-provider.ts`
- Modify: `packages/indexer-sqlite/src/index.ts`, `packages/indexer-sqlite/package.json` (add `@statewalker/indexer-fulltext: workspace:^`)
- Test: `packages/indexer-sqlite/tests/fts.test.ts`

**Interfaces:**
- Consumes: Task 3 exports; `inTransaction(db, cb)`; `FullTextConfig`, `FullTextIndex`, `FullTextBlock`, `FulltextQuery`, `FulltextResult`, `FULL_TEXT_TYPE`, `FullTextProvider`, `newFullTextAccess` from `@statewalker/indexer-fulltext`; suites `runFullTextConformanceSuite`, `runFullTextMultiWordSuite`, `runRrfBlendingSuite` from `@statewalker/indexer-tests`.
- Produces: `newSqliteFullTextProvider(): SqliteModalityProvider<FullTextConfig, FullTextIndex>`; test helper `asModalityProvider(provider, openDb)`.

- [ ] **Step 1: Test helper — adapt an async provider to the sync suites**

`tests/support/as-modality-provider.ts`:

```ts
import type { Db } from "@statewalker/db-api";
import type { ModalityProvider, ScoredHit, SearchIndex } from "@statewalker/indexer-api";
import { createSqliteIndexer, type SqliteModalityProvider } from "../../src/index.js";

type Fn = (...args: unknown[]) => unknown;
const CALLS = ["getIndexInfo", "addDocument", "addDocuments", "deleteDocuments", "getSize", "close", "flush", "deleteIndex"];
const STREAMS = ["search", "getDocumentPaths", "getDocumentBlocksRefs", "getDocumentsBlocks"];

/**
 * The per-modality suites call a synchronous `provider.create(config)`. Each
 * call here opens a fresh Db and a one-sub-index Index through the public
 * `createSqliteIndexer`, and returns a facade whose methods await it. Only the
 * methods of `SearchIndex` + `getIndexInfo` exist on the facade, so
 * `isPersistable` stays false.
 */
export function asModalityProvider<C, I extends SearchIndex<unknown, unknown, ScoredHit>>(
  provider: SqliteModalityProvider<C, I>,
  openDb: () => Promise<Db>,
): ModalityProvider<C, I> {
  return {
    type: provider.type,
    create(config: C): I {
      const ready = (async () => {
        const indexer = await createSqliteIndexer({ db: await openDb(), providers: [provider] });
        const index = await indexer.createIndex({
          name: "t",
          subIndexes: { s: { type: provider.type, ...(config as Record<string, unknown>) } },
        });
        return index.getBinding("s")?.index as unknown as Record<string, Fn>;
      })();
      const facade: Record<string, Fn> = {};
      for (const m of CALLS) facade[m] = async (...a) => (await ready)[m]?.(...a);
      for (const m of STREAMS) {
        facade[m] = async function* (...a: unknown[]) {
          yield* (await ready)[m]?.(...a) as AsyncGenerator<unknown>;
        };
      }
      return facade as unknown as I;
    },
  };
}
```

- [ ] **Step 2: Write the failing tests**

`tests/fts.test.ts`:

```ts
import type { DocumentPath } from "@statewalker/indexer-api";
import { type FullTextProvider, newFullTextAccess } from "@statewalker/indexer-fulltext";
import {
  collect,
  runFullTextConformanceSuite,
  runFullTextMultiWordSuite,
  runRrfBlendingSuite,
} from "@statewalker/indexer-tests";
import { describe, expect, it } from "vitest";
import { createSqliteIndexer, newSqliteFullTextProvider } from "../src/index.js";
import { asModalityProvider } from "./support/as-modality-provider.js";
import { flavours, indexerFactory } from "./support/dbs.js";

const ftConfig = { type: "fulltext" as const, language: "en" };
const ft = newFullTextAccess("q");

for (const flavour of flavours) {
  const label = `SQLite FTS5 (${flavour.name})`;
  const factory = indexerFactory(flavour, () => [newSqliteFullTextProvider()]);

  runFullTextConformanceSuite(
    label,
    asModalityProvider(newSqliteFullTextProvider(), flavour.open) as FullTextProvider,
    { config: { language: "en" } },
  );
  runFullTextMultiWordSuite(label, { factory, config: ftConfig });
  runRrfBlendingSuite(label, {
    factory,
    config: ftConfig,
    populate: async (index) => {
      const sub = ft.get(index);
      await sub.addDocument([{ path: "/d/a", blockId: "a", content: "alpha alpha alpha" }]);
      await sub.addDocument([{ path: "/d/b", blockId: "b", content: "alpha beta" }]);
      await sub.addDocument([{ path: "/d/c", blockId: "c", content: "alpha gamma" }]);
    },
    buildQuery: ({ topK }) => ({ queries: ["alpha"], ...(topK !== undefined ? { topK } : {}) }),
  });

  describe(`${label} — SQLite specifics`, () => {
    async function open(language = "en") {
      const db = await flavour.open();
      const indexer = await createSqliteIndexer({ db, providers: [newSqliteFullTextProvider()] });
      const index = await indexer.createIndex({ name: "t", subIndexes: { q: { type: "fulltext", language } } });
      return { db, indexer, index, sub: ft.get(index) };
    }
    const search = async (sub: ReturnType<typeof ft.get>, queries: string[], paths?: DocumentPath[]) =>
      collect(sub.search({ queries, ...(paths ? { paths } : {}) }));

    it("stems English with porter and folds diacritics", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", content: "Running café" }]);
      expect((await search(sub, ["run"])).map((h) => h.blockId)).toEqual(["b"]);
      expect((await search(sub, ["cafe"])).map((h) => h.blockId)).toEqual(["b"]);
    });

    it("opens an unknown language with unicode61 instead of throwing", async () => {
      const { sub } = await open("xx");
      await sub.addDocument([{ path: "/d/1", blockId: "b", content: "Running" }]);
      expect((await search(sub, ["running"])).map((h) => h.blockId)).toEqual(["b"]);
      expect(await search(sub, ["run"])).toEqual([]);
    });

    it("treats FTS5 syntax in queries as words, never as a syntax error", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", content: "and or near foo" }]);
      for (const q of ['"', "AND", "foo*", "NEAR(foo", "-foo", "?!", ""]) {
        await expect(search(sub, [q])).resolves.toBeDefined();
      }
      expect((await search(sub, ["AND"])).map((h) => h.blockId)).toEqual(["b"]);
    });

    it("re-adding a block replaces its content", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", content: "alpha" }]);
      await sub.addDocument([{ path: "/d/1", blockId: "b", content: "beta" }]);
      expect(await sub.getSize()).toBe(1);
      expect(await search(sub, ["alpha"])).toEqual([]);
      expect((await search(sub, ["beta"])).map((h) => h.blockId)).toEqual(["b"]);
    });

    it("scopes by path prefix, case-sensitively and on component boundaries", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/docs/a", blockId: "1", content: "alpha" }]);
      await sub.addDocument([{ path: "/Docs/b", blockId: "2", content: "alpha" }]);
      await sub.addDocument([{ path: "/docsx/c", blockId: "3", content: "alpha" }]);
      expect((await search(sub, ["alpha"], ["/docs"])).map((h) => h.blockId)).toEqual(["1"]);
    });

    it("returns a snippet and a positive score", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", content: "the quick brown fox" }]);
      const [hit] = await search(sub, ["fox"]);
      expect(hit?.snippet).toContain("fox");
      expect(hit?.score).toBeGreaterThan(0);
    });

    it("keeps metadata and returns it from getDocumentsBlocks", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", content: "x", metadata: { k: 1 } }]);
      expect(await collect(sub.getDocumentsBlocks())).toEqual([
        { path: "/d/1", blockId: "b", content: "x", metadata: { k: 1 } },
      ]);
    });

    it("a new indexer on the same Db searches the old data", async () => {
      const { db, indexer, sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", content: "persisted words" }]);
      await indexer.close();
      const again = await createSqliteIndexer({ db, providers: [newSqliteFullTextProvider()] });
      const index = await again.getIndex("t");
      expect((await search(ft.get(index!), ["persisted"])).map((h) => h.blockId)).toEqual(["b"]);
    });
  });
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @statewalker/indexer-sqlite test -- fts`
Expected: FAIL — `newSqliteFullTextProvider` is not exported.

- [ ] **Step 4: Implement**

`src/fts-provider.ts`:

```ts
import type { DocumentPath, Metadata, PathSelector } from "@statewalker/indexer-api";
import { toAsyncIterable } from "@statewalker/indexer-core";
import {
  FULL_TEXT_TYPE,
  type FullTextBlock,
  type FullTextConfig,
  type FullTextIndex,
  type FulltextQuery,
  type FulltextResult,
} from "@statewalker/indexer-fulltext";
import { inTransaction } from "@statewalker/db-sqlite";
import { newEnumeration } from "./enumeration.js";
import { pathPrefixSql } from "./path-sql.js";
import type { SqliteModalityProvider } from "./types.js";

/** `en` gets the Porter stemmer; any other language (known or not) gets plain `unicode61`. */
function tokenizerFor(language: string): string {
  return language === "en" ? "porter unicode61 remove_diacritics 2" : "unicode61 remove_diacritics 2";
}

/**
 * One FTS5 MATCH expression per query string: every word with a letter or a
 * digit, double-quoted (so `AND`, `*`, `NEAR(` are plain words), OR-joined so
 * partial matches are returned. `null` when nothing is searchable.
 */
export function toMatchExpression(query: string): string | null {
  const words = query
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .map((w) => `"${w.replaceAll('"', '""')}"`);
  return words.length > 0 ? words.join(" OR ") : null;
}

export function newSqliteFullTextProvider(): SqliteModalityProvider<FullTextConfig, FullTextIndex> {
  return {
    type: FULL_TEXT_TYPE,

    async drop({ db, prefix }) {
      await db.exec(`DROP TABLE IF EXISTS ${prefix}fts`);
    },

    async open({ db, prefix, blockIds }, config) {
      const table = `${prefix}fts`;
      const blocks = blockIds.table;
      await db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING fts5(content, metadata UNINDEXED, tokenize='${tokenizerFor(config.language)}')`,
      );
      const list = newEnumeration(db, blockIds, `SELECT rowid AS id FROM ${table}`);
      let closed = false;
      const ensureOpen = () => {
        if (closed) throw new Error("FullTextIndex is closed");
      };
      const selectIds = async (selectors: PathSelector[] | AsyncIterable<PathSelector>) => {
        const all: PathSelector[] = [];
        for await (const s of toAsyncIterable(selectors)) all.push(s);
        return all;
      };

      const index: FullTextIndex = {
        async getIndexInfo() {
          return { language: config.language, metadata: config.metadata };
        },

        async *search(params: FulltextQuery): AsyncGenerator<FulltextResult> {
          ensureOpen();
          const topK = params.topK ?? 100;
          const scope = pathPrefixSql("b.path", params.paths ?? []);
          // Several queries accumulate (SUM): a block matching more of them ranks higher.
          const merged = new Map<number, { score: number; best: number; snippet: string }>();
          for (const query of params.queries ?? []) {
            const match = toMatchExpression(query);
            if (!match) continue;
            const rows = await db.query<{ id: number; score: number; snippet: string }>(
              `SELECT ${table}.rowid AS id, -bm25(${table}) AS score, snippet(${table}, 0, '', '', '…', 16) AS snippet FROM ${table} JOIN ${blocks} b ON b.id = ${table}.rowid WHERE ${table} MATCH ? AND ${scope.sql} ORDER BY score DESC LIMIT ?`,
              [match, ...scope.params, topK],
            );
            for (const r of rows) {
              const id = Number(r.id);
              const prev = merged.get(id);
              if (!prev) merged.set(id, { score: r.score, best: r.score, snippet: r.snippet });
              else {
                prev.score += r.score;
                if (r.score > prev.best) Object.assign(prev, { best: r.score, snippet: r.snippet });
              }
            }
          }
          const top = [...merged.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, topK);
          const refs = await blockIds.refs(db, top.map(([id]) => id));
          for (const [id, hit] of top) {
            const ref = refs.get(id);
            if (ref) yield { ...ref, score: hit.score, snippet: hit.snippet };
          }
        },

        async addDocument(blocksIn: FullTextBlock[]) {
          ensureOpen();
          if (blocksIn.length === 0) return;
          await inTransaction(db, async (tx) => {
            const ids = await blockIds.ensure(tx, blocksIn);
            for (const [i, id] of ids.entries()) {
              const block = blocksIn[i] as FullTextBlock;
              // FTS5 has no UPSERT: delete then insert, atomically inside the transaction.
              await tx.query(`DELETE FROM ${table} WHERE rowid = ?`, [id]);
              await tx.query(`INSERT INTO ${table} (rowid, content, metadata) VALUES (?, ?, ?)`, [
                id,
                block.content,
                block.metadata ? JSON.stringify(block.metadata) : null,
              ]);
            }
          });
        },

        async addDocuments(batches) {
          for await (const batch of batches) await this.addDocument(batch);
        },

        async deleteDocuments(selectors) {
          ensureOpen();
          const sels = await selectIds(selectors);
          await inTransaction(db, async (tx) => {
            const ids = await blockIds.select(tx, sels);
            await tx.query(`DELETE FROM ${table} WHERE rowid IN (SELECT value FROM json_each(?))`, [
              JSON.stringify(ids),
            ]);
          });
        },

        getSize: (p?: DocumentPath) => list.size(p),
        getDocumentPaths: (p?: DocumentPath) => list.paths(p),
        getDocumentBlocksRefs: (p?: DocumentPath) => list.refs(p),

        async *getDocumentsBlocks(p?: DocumentPath): AsyncGenerator<FullTextBlock> {
          const scope = pathPrefixSql("b.path", p ? [p] : []);
          const rows = await db.query<{ path: string; block_id: string; content: string; metadata: string | null }>(
            `SELECT b.path, b.block_id, f.content, f.metadata FROM ${table} f JOIN ${blocks} b ON b.id = f.rowid WHERE ${scope.sql} ORDER BY b.id`,
            scope.params,
          );
          for (const r of rows) {
            yield {
              path: r.path as DocumentPath,
              blockId: r.block_id,
              content: r.content,
              ...(r.metadata ? { metadata: JSON.parse(r.metadata) as Metadata } : {}),
            };
          }
        },

        async close() {
          closed = true;
        },
        async flush() {},
        async deleteIndex() {
          closed = true;
          await db.exec(`DROP TABLE IF EXISTS ${table}`);
        },
      };
      return index;
    },
  };
}
```

Note the `getDocumentsBlocks` test expects no `metadata` key when none was stored — the spread above produces exactly that.

Add to `src/index.ts`: `export { newSqliteFullTextProvider } from "./fts-provider.js";`
Add `"@statewalker/indexer-fulltext": "workspace:^"` to `dependencies`; run `pnpm install`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @statewalker/indexer-sqlite test && pnpm --filter @statewalker/indexer-sqlite typecheck`
Expected: PASS (fulltext conformance, multi-word, RRF and 8 specifics, × 2 flavours; kernel tests still green).

- [ ] **Step 6: Lint and commit**

```bash
pnpm biome check --write --unsafe packages/indexer-sqlite
git add packages/indexer-sqlite pnpm-lock.yaml
git commit -m "feat(indexer-sqlite): FTS5 provider (porter for en, quoted OR words, sum-merge, snippet)"
```

---

### Task 5: Vector provider over `db-sqlite-index/vector`

**Files:**
- Create: `packages/indexer-sqlite/src/vector-provider.ts`
- Modify: `packages/indexer-sqlite/src/index.ts`, `packages/indexer-sqlite/package.json` (add `@statewalker/indexer-vector: workspace:^`, `@statewalker/db-sqlite-index: catalog:`)
- Test: `packages/indexer-sqlite/tests/vector.test.ts`

**Interfaces:**
- Consumes: `VectorIndex`, `dropVectorIndex` from `@statewalker/db-sqlite-index/vector` (P2, exact signatures in "Consumed contracts"); `VECTOR_TYPE`, `VectorConfig`, `VectorIndex` (contract), `VectorBlock`, `VectorQuery`, `VectorResult`, `VectorProvider`, `newVectorAccess` from `@statewalker/indexer-vector`; `validateDimensionality` from `@statewalker/indexer-core`; `runVectorConformanceSuite`, `runKernelConformanceSuite`, `runMultiInstanceConformanceSuite`.
- Produces: `newSqliteVectorProvider(): SqliteModalityProvider<VectorConfig, VectorIndex>`. Tables: the engine's, under `${ctx.prefix}vec_`; size and enumeration join `engine.idTable`. Score = `1 - cosine distance`; several embeddings merge by max (same as every other backend).

- [ ] **Step 1: Write the failing tests**

`tests/vector.test.ts`:

```ts
import { newFullTextAccess } from "@statewalker/indexer-fulltext";
import {
  collect,
  runKernelConformanceSuite,
  runMultiInstanceConformanceSuite,
  runVectorConformanceSuite,
} from "@statewalker/indexer-tests";
import { newVectorAccess, type VectorProvider } from "@statewalker/indexer-vector";
import { describe, expect, it } from "vitest";
import {
  createSqliteIndexer,
  newSqliteFullTextProvider,
  newSqliteVectorProvider,
} from "../src/index.js";
import { asModalityProvider } from "./support/as-modality-provider.js";
import { flavours, indexerFactory } from "./support/dbs.js";

const vec = (...xs: number[]) => Float32Array.from(xs);

for (const flavour of flavours) {
  const label = `SQLite (${flavour.name})`;
  const factory = indexerFactory(flavour, () => [newSqliteFullTextProvider(), newSqliteVectorProvider()]);

  runVectorConformanceSuite(
    label,
    asModalityProvider(newSqliteVectorProvider(), flavour.open) as VectorProvider,
    { config: { dimensionality: 3, model: "test" } },
  );

  runKernelConformanceSuite(label, {
    factory,
    primaryConfig: { type: "fulltext", language: "en" },
    secondaryConfig: { type: "vector", dimensionality: 3, model: "test" },
  });

  runMultiInstanceConformanceSuite(label, {
    factory,
    fullText: {
      configs: [() => ({ type: "fulltext", language: "en" }), () => ({ type: "fulltext", language: "fr" })],
      ingest: async (index, name, block) => newFullTextAccess(name).get(index).addDocument([block]),
      buildQuery: (query: string) => ({ queries: [query] }),
    },
    vector: {
      configs: [
        () => ({ type: "vector", dimensionality: 3, model: "model-a" }),
        () => ({ type: "vector", dimensionality: 3, model: "model-b" }),
      ],
      ingest: async (index, name, block) => newVectorAccess(name).get(index).addDocument([block]),
      buildQuery: (embedding: Float32Array) => ({ embeddings: [embedding] }),
    },
  });

  describe(`${label} — vector specifics`, () => {
    async function open() {
      const db = await flavour.open();
      const indexer = await createSqliteIndexer({ db, providers: [newSqliteVectorProvider()] });
      const index = await indexer.createIndex({
        name: "t",
        subIndexes: { v: { type: "vector", dimensionality: 3, model: "m" } },
      });
      return { db, indexer, sub: newVectorAccess("v").get(index) };
    }

    it("re-adding a block replaces its vector", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", embedding: vec(1, 0, 0) }]);
      await sub.addDocument([{ path: "/d/1", blockId: "b", embedding: vec(0, 1, 0) }]);
      expect(await sub.getSize()).toBe(1);
      const [hit] = await collect(sub.search({ embeddings: [vec(0, 1, 0)], topK: 1 }));
      expect(hit?.score).toBeCloseTo(1, 1);
    });

    it("scopes by path prefix", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/a/1", blockId: "x", embedding: vec(1, 0, 0) }]);
      await sub.addDocument([{ path: "/b/1", blockId: "y", embedding: vec(1, 0, 0) }]);
      const hits = await collect(sub.search({ embeddings: [vec(1, 0, 0)], paths: ["/b"] }));
      expect(hits.map((h) => h.blockId)).toEqual(["y"]);
    });

    it("rejects a vector of the wrong dimensionality", async () => {
      const { sub } = await open();
      await expect(sub.addDocument([{ path: "/d/1", blockId: "b", embedding: vec(1, 0) }])).rejects.toThrow(
        "Expected dimensionality 3, got 2",
      );
    });

    it("getDocumentsBlocks returns the stored embeddings", async () => {
      const { sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", embedding: vec(0.6, 0.8, 0) }]);
      const [block] = await collect(sub.getDocumentsBlocks());
      // Stored as the engine keeps it: normalised for cosine (this one is already unit length).
      const got = Array.from(block?.embedding ?? []);
      [0.6, 0.8, 0].forEach((x, i) => expect(got[i]).toBeCloseTo(x, 5));
    });

    it("a new indexer on the same Db searches the old vectors", async () => {
      const { db, indexer, sub } = await open();
      await sub.addDocument([{ path: "/d/1", blockId: "b", embedding: vec(1, 0, 0) }]);
      await indexer.close();
      const again = await createSqliteIndexer({ db, providers: [newSqliteVectorProvider()] });
      const index = await again.getIndex("t");
      const hits = await collect(newVectorAccess("v").get(index!).search({ embeddings: [vec(1, 0, 0)] }));
      expect(hits.map((h) => h.blockId)).toEqual(["b"]);
    });
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @statewalker/indexer-sqlite test -- vector`
Expected: FAIL — `newSqliteVectorProvider` is not exported.

- [ ] **Step 3: Implement**

`src/vector-provider.ts`:

```ts
import type { DocumentPath, PathSelector } from "@statewalker/indexer-api";
import { dropVectorIndex, VectorIndex as VectorEngine } from "@statewalker/db-sqlite-index/vector";
import { toAsyncIterable, validateDimensionality } from "@statewalker/indexer-core";
import {
  VECTOR_TYPE,
  type VectorBlock,
  type VectorConfig,
  type VectorIndex,
  type VectorQuery,
  type VectorResult,
} from "@statewalker/indexer-vector";
import { newEnumeration } from "./enumeration.js";
import type { SqliteModalityProvider } from "./types.js";

/**
 * Wraps the id-based `VectorIndex` engine. The engine owns its tables under
 * `{prefix}vec_` and its own transactions (never call it inside `inTransaction`);
 * this provider adds only the `{path, blockId}` mapping. Size and enumeration
 * join the engine's `idTable`, so they list exactly what the engine holds.
 */
export function newSqliteVectorProvider(): SqliteModalityProvider<VectorConfig, VectorIndex> {
  return {
    type: VECTOR_TYPE,

    async drop({ db, prefix }) {
      await dropVectorIndex(db, `${prefix}vec_`);
    },

    async open({ db, prefix, blockIds }, config) {
      const engine = new VectorEngine({ db, prefix: `${prefix}vec_`, dims: config.dimensionality, metric: "cosine" });
      await engine.init();
      const list = newEnumeration(db, blockIds, `SELECT id FROM ${engine.idTable}`);
      let closed = false;
      const ensureOpen = () => {
        if (closed) throw new Error("VectorIndex is closed");
      };
      const info = { dimensionality: config.dimensionality, model: config.model, metadata: config.metadata };

      const index: VectorIndex = {
        async getIndexInfo() {
          return { ...info };
        },

        async *search(params: VectorQuery): AsyncGenerator<VectorResult> {
          ensureOpen();
          const k = params.topK ?? 100;
          const allowed = params.paths?.length
            ? new Set(await blockIds.select(db, params.paths.map((path) => ({ path }))))
            : undefined;
          const filter = allowed ? (id: number) => allowed.has(id) : undefined;
          const best = new Map<number, number>();
          for (const q of params.embeddings ?? []) {
            for (const hit of await engine.search(q, { k, ...(filter ? { filter } : {}) })) {
              const score = 1 - hit.distance;
              if (score > (best.get(hit.id) ?? -Infinity)) best.set(hit.id, score);
            }
          }
          const top = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
          const refs = await blockIds.refs(db, top.map(([id]) => id));
          for (const [id, score] of top) {
            const ref = refs.get(id);
            if (ref) yield { ...ref, score };
          }
        },

        async addDocument(blocks: VectorBlock[]) {
          ensureOpen();
          if (blocks.length === 0) return;
          for (const b of blocks) validateDimensionality(info, b.embedding);
          const ids = await blockIds.ensure(db, blocks);
          await engine.upsert(ids.map((id, i) => ({ id, vector: (blocks[i] as VectorBlock).embedding })));
        },

        async addDocuments(batches) {
          for await (const batch of batches) await this.addDocument(batch);
        },

        async deleteDocuments(selectors) {
          ensureOpen();
          const sels: PathSelector[] = [];
          for await (const s of toAsyncIterable(selectors)) sels.push(s);
          const ids = await blockIds.select(db, sels);
          if (ids.length === 0) return;
          await engine.delete(ids);
        },

        getSize: (p?: DocumentPath) => list.size(p),
        getDocumentPaths: (p?: DocumentPath) => list.paths(p),
        getDocumentBlocksRefs: (p?: DocumentPath) => list.refs(p),

        async *getDocumentsBlocks(p?: DocumentPath): AsyncGenerator<VectorBlock> {
          const entries = await list.entries(p);
          const vectors = await engine.getVectors(entries.map((e) => e.id));
          for (const e of entries) {
            const embedding = vectors.get(e.id);
            if (embedding) yield { path: e.path, blockId: e.blockId, embedding };
          }
        },

        async close() {
          closed = true;
        },
        async flush() {},
        async deleteIndex() {
          closed = true;
          await dropVectorIndex(db, `${prefix}vec_`);
        },
      };
      return index;
    },
  };
}
```

Add to `src/index.ts`: `export { newSqliteVectorProvider } from "./vector-provider.js";`
Add dependencies `"@statewalker/db-sqlite-index": "catalog:"`, `"@statewalker/indexer-vector": "workspace:^"`; `pnpm install`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @statewalker/indexer-sqlite test && pnpm --filter @statewalker/indexer-sqlite typecheck`
Expected: PASS — vector conformance, kernel conformance (incl. adopt / skip / reinit through the shared-Db reopen), multi-instance (2 FTS, 2 vector, FTS + 2 vectors fused), 5 vector specifics, × 2 flavours.

- [ ] **Step 5: Lint and commit**

```bash
pnpm biome check --write --unsafe packages/indexer-sqlite
git add packages/indexer-sqlite pnpm-lock.yaml
git commit -m "feat(indexer-sqlite): vector provider over db-sqlite-index/vector"
```

---

### Task 6: N-gram provider, the n-gram conformance suite, README and release

**Files:**
- Create: `packages/indexer-tests/src/conformance/ngram.suite.ts`
- Modify: `packages/indexer-tests/src/index.ts`, `packages/indexer-tests/package.json` (add `@statewalker/indexer-ngram: workspace:^`)
- Create: `packages/indexer-sqlite/src/ngram-provider.ts`
- Modify: `packages/indexer-sqlite/src/index.ts`, `packages/indexer-sqlite/package.json` (add `@statewalker/indexer-ngram: workspace:^`)
- Test: `packages/indexer-sqlite/tests/ngram.test.ts`
- Create: `packages/indexer-sqlite/README.md`
- Create: `.changeset/indexer-sqlite.md`, `.changeset/indexer-tests-ngram-suite.md`

**Interfaces:**
- Consumes: `NgramStore` (P3, exact signature in "Consumed contracts"); everything from Task 2.
- Produces: `runNgramConformanceSuite(name, { factory, config })`; `newSqliteNgramProvider(): SqliteModalityProvider<NgramConfig, NgramIndex>`; `createSqliteIndexer` default providers documented in README (callers pass `[newSqliteFullTextProvider(), newSqliteVectorProvider(), newSqliteNgramProvider()]`).

- [ ] **Step 1: Write the n-gram suite (Indexer-driven, so any backend fits)**

`packages/indexer-tests/src/conformance/ngram.suite.ts`:

```ts
// =============================================================================
// N-gram (grep) conformance — Indexer-driven, backend-agnostic.
//
// Pins the NgramIndex contract: exact literal and regex matches with UTF-16
// offsets and 1-based lines, case sensitivity (default sensitive), score =
// match count, path scoping, deletion, replacement, no match across blocks,
// patterns too short for an n-gram, and the RRF path through Index.search.
// =============================================================================

import type { DocumentPath, Index } from "@statewalker/indexer-api";
import { grep, newNgramAccess } from "@statewalker/indexer-ngram";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collect } from "./test-utils.js";
import type { IndexerFactory } from "./types.js";

export interface NgramSuiteOptions {
  factory: IndexerFactory;
  /** A complete n-gram sub-index config (registered as `"g"`). */
  config: { type: string } & Record<string, unknown>;
}

const A = "function fooBar() {\n  return fooBar;\n}\n";
const B = "const FOOBAR = 1;\n";
const C = "no match here\nfoo  bar\n";

export function runNgramConformanceSuite(name: string, options: NgramSuiteOptions): void {
  const { factory, config } = options;
  const access = newNgramAccess("g");

  describe(`${name} — n-gram conformance`, () => {
    let indexer: Awaited<ReturnType<typeof factory.create>>;
    let index: Index;

    beforeEach(async () => {
      indexer = await factory.create();
      index = await indexer.createIndex({ name: "ng-test", subIndexes: { g: config } });
      const sub = access.get(index);
      await sub.addDocument([{ path: "/src/a.ts" as DocumentPath, blockId: "a", content: A }]);
      await sub.addDocument([{ path: "/src/b.ts" as DocumentPath, blockId: "b", content: B }]);
      await sub.addDocument([{ path: "/docs/c.md" as DocumentPath, blockId: "c", content: C }]);
      await indexer.flush();
    });

    afterEach(async () => {
      await indexer.close().catch(() => undefined);
      await factory.cleanup?.();
    });

    it("finds a literal with offsets, lines and score = count", async () => {
      const second = A.indexOf("fooBar", 15);
      const { hits, truncated } = await grep(index, "g", "fooBar");
      expect(truncated).toBe(false);
      expect(hits).toEqual([
        {
          path: "/src/a.ts",
          blockId: "a",
          score: 2,
          count: 2,
          matches: [
            { start: 9, end: 15, line: 1 },
            { start: second, end: second + 6, line: 2 },
          ],
        },
      ]);
    });

    it("is case-sensitive by default and folds case on request, ranking by count", async () => {
      expect((await grep(index, "g", "foobar")).hits).toEqual([]);
      const { hits } = await grep(index, "g", "foobar", { caseSensitive: false });
      expect(hits.map((h) => [h.blockId, h.count])).toEqual([
        ["a", 2],
        ["b", 1],
      ]);
    });

    it("reads regex metacharacters literally unless regex: true", async () => {
      expect((await grep(index, "g", "fooBar()")).hits.map((h) => h.count)).toEqual([1]);
      const { hits } = await grep(index, "g", "foo\\s+bar", { regex: true });
      expect(hits.map((h) => [h.blockId, h.matches[0]?.line])).toEqual([["c", 2]]);
    });

    it("finds patterns shorter than an n-gram", async () => {
      expect((await grep(index, "g", "()")).hits.map((h) => h.blockId)).toEqual(["a"]);
    });

    it("scopes by path prefix", async () => {
      const { hits } = await grep(index, "g", "foo", { caseSensitive: false, paths: ["/src" as DocumentPath] });
      expect(hits.map((h) => h.blockId).sort()).toEqual(["a", "b"]);
    });

    it("never matches across two blocks of one document", async () => {
      await access.get(index).addDocument([
        { path: "/split" as DocumentPath, blockId: "1", content: "xyzab" },
        { path: "/split" as DocumentPath, blockId: "2", content: "cdxyz" },
      ]);
      expect((await grep(index, "g", "abcd")).hits).toEqual([]);
    });

    it("deleteDocuments and re-adding a block are reflected", async () => {
      const sub = access.get(index);
      await sub.deleteDocuments([{ path: "/src/a.ts" as DocumentPath }]);
      expect((await grep(index, "g", "fooBar")).hits).toEqual([]);
      await sub.addDocument([{ path: "/docs/c.md" as DocumentPath, blockId: "c", content: "fooBar once" }]);
      expect((await grep(index, "g", "foo  bar", {})).hits).toEqual([]);
      expect((await grep(index, "g", "fooBar")).hits.map((h) => h.blockId)).toEqual(["c"]);
      expect(await sub.getSize()).toBe(2);
    });

    it("joins Index.search through its sub-query, with the n-gram hit as sub-result", async () => {
      const results = await collect(index.search({ topK: 5, subQueries: { g: { pattern: "fooBar" } } }));
      expect(results.map((r) => r.blockId)).toEqual(["a"]);
      expect(access.getResult(results[0]!)?.count).toBe(2);
    });
  });
}
```

Export from `packages/indexer-tests/src/index.ts`:

```ts
export type { NgramSuiteOptions } from "./conformance/ngram.suite.js";
export { runNgramConformanceSuite } from "./conformance/ngram.suite.js";
```

Add `"@statewalker/indexer-ngram": "workspace:^"` to `packages/indexer-tests/package.json` `dependencies`.

- [ ] **Step 2: Write the failing backend test**

`packages/indexer-sqlite/tests/ngram.test.ts`:

```ts
import { runNgramConformanceSuite } from "@statewalker/indexer-tests";
import { grep, newNgramAccess } from "@statewalker/indexer-ngram";
import { describe, expect, it } from "vitest";
import { createSqliteIndexer, newSqliteNgramProvider } from "../src/index.js";
import { flavours, indexerFactory } from "./support/dbs.js";

for (const flavour of flavours) {
  const factory = indexerFactory(flavour, () => [newSqliteNgramProvider()]);
  for (const store of ["fts5", "postings"] as const) {
    runNgramConformanceSuite(`SQLite n-gram ${store} (${flavour.name})`, {
      factory,
      config: { type: "ngram", store },
    });
  }

  describe(`SQLite n-gram (${flavour.name}) — specifics`, () => {
    it("defaults to the fts5 store and survives a reopen", async () => {
      const db = await flavour.open();
      const first = await createSqliteIndexer({ db, providers: [newSqliteNgramProvider()] });
      const index = await first.createIndex({ name: "t", subIndexes: { g: { type: "ngram" } } });
      expect(await newNgramAccess("g").get(index).getIndexInfo()).toEqual({ store: "fts5" });
      await newNgramAccess("g").get(index).addDocument([{ path: "/d", blockId: "1", content: "needle" }]);
      await first.close();
      const again = await createSqliteIndexer({ db, providers: [newSqliteNgramProvider()] });
      const reopened = await again.getIndex("t");
      expect((await grep(reopened!, "g", "needle")).hits.map((h) => h.blockId)).toEqual(["1"]);
    });
  });
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @statewalker/indexer-sqlite test -- ngram`
Expected: FAIL — `newSqliteNgramProvider` is not exported.

- [ ] **Step 4: Implement the provider**

`packages/indexer-sqlite/src/ngram-provider.ts`:

```ts
import type { DocumentPath, PathSelector } from "@statewalker/indexer-api";
import { NgramStore } from "@statewalker/db-sqlite-index/ngram";
import { toAsyncIterable } from "@statewalker/indexer-core";
import {
  NGRAM_TYPE,
  type NgramBlock,
  type NgramConfig,
  type NgramIndex,
  type NgramMatch,
  type NgramQuery,
  type NgramResult,
  type NgramSearchSummary,
} from "@statewalker/indexer-ngram";
import { newEnumeration } from "./enumeration.js";
import type { SqliteModalityProvider } from "./types.js";

/** 1-based line of each offset, from the positions of `\n` in `text`. */
function withLines(text: string, matches: { start: number; end: number }[]): NgramMatch[] {
  const breaks: number[] = [];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) breaks.push(i);
  let line = 1;
  let b = 0;
  return [...matches]
    .sort((x, y) => x.start - y.start)
    .map(({ start, end }) => {
      while (b < breaks.length && (breaks[b] as number) < start) {
        b++;
        line++;
      }
      return { start, end, line };
    });
}

/**
 * Wraps the id-based `NgramStore` (own transactions; never call it inside
 * `inTransaction`). Size and enumeration join the store's `idTable`.
 * Score = match count; ties keep the store's ascending-id order.
 */
export function newSqliteNgramProvider(): SqliteModalityProvider<NgramConfig, NgramIndex> {
  return {
    type: NGRAM_TYPE,

    async drop({ db, prefix }) {
      await new NgramStore({ db, prefix: `${prefix}ng_` }).drop(); // drops either store's tables
    },

    async open({ db, prefix, blockIds }, config) {
      const storeKind = config.store ?? "fts5";
      const store = new NgramStore({ db, prefix: `${prefix}ng_`, store: storeKind });
      await store.init();
      const list = newEnumeration(db, blockIds, `SELECT id FROM ${store.idTable}`);
      let closed = false;
      const ensureOpen = () => {
        if (closed) throw new Error("NgramIndex is closed");
      };

      const index: NgramIndex = {
        async getIndexInfo() {
          return { store: storeKind, ...(config.metadata ? { metadata: config.metadata } : {}) };
        },

        async *search(params: NgramQuery): AsyncGenerator<NgramResult, NgramSearchSummary> {
          ensureOpen();
          const allowed = params.paths?.length
            ? new Set(await blockIds.select(db, params.paths.map((path) => ({ path }))))
            : undefined;
          const result = await store.search(params.pattern, {
            regex: params.regex ?? false,
            caseSensitive: params.caseSensitive ?? true,
            limit: params.topK ?? 100,
            ...(allowed ? { filter: (id: number) => allowed.has(id) } : {}),
          });
          const hits = result.hits.filter((h) => h.matches.length > 0);
          const ids = hits.map((h) => h.id);
          const [texts, refs] = await Promise.all([store.getTexts(ids), blockIds.refs(db, ids)]);
          const ranked = hits
            .map((h) => ({ h, ref: refs.get(h.id), text: texts.get(h.id) ?? "" }))
            .sort((x, y) => y.h.matches.length - x.h.matches.length);
          for (const { h, ref, text } of ranked) {
            if (!ref) continue;
            const count = h.matches.length;
            yield { ...ref, score: count, count, matches: withLines(text, h.matches) };
          }
          return { truncated: result.truncated };
        },

        async addDocument(blocks: NgramBlock[]) {
          ensureOpen();
          if (blocks.length === 0) return;
          const ids = await blockIds.ensure(db, blocks);
          await store.upsert(ids.map((id, i) => ({ id, text: (blocks[i] as NgramBlock).content })));
        },

        async addDocuments(batches) {
          for await (const batch of batches) await this.addDocument(batch);
        },

        async deleteDocuments(selectors) {
          ensureOpen();
          const sels: PathSelector[] = [];
          for await (const s of toAsyncIterable(selectors)) sels.push(s);
          const ids = await blockIds.select(db, sels);
          if (ids.length === 0) return;
          await store.delete(ids);
        },

        getSize: (p?: DocumentPath) => list.size(p),
        getDocumentPaths: (p?: DocumentPath) => list.paths(p),
        getDocumentBlocksRefs: (p?: DocumentPath) => list.refs(p),

        async *getDocumentsBlocks(p?: DocumentPath): AsyncGenerator<NgramBlock> {
          const entries = await list.entries(p);
          const texts = await store.getTexts(entries.map((e) => e.id));
          for (const e of entries) {
            const content = texts.get(e.id);
            if (content !== undefined) yield { path: e.path, blockId: e.blockId, content };
          }
        },

        async close() {
          closed = true;
        },
        async flush() {},
        async deleteIndex() {
          closed = true;
          await store.drop();
        },
      };
      return index;
    },
  };
}
```

Add to `src/index.ts`: `export { newSqliteNgramProvider } from "./ngram-provider.js";`
Add `"@statewalker/indexer-ngram": "workspace:^"` to `dependencies`; `pnpm install`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @statewalker/indexer-sqlite test && pnpm --filter @statewalker/indexer-tests typecheck && pnpm --filter @statewalker/indexer-sqlite typecheck`
Expected: PASS — n-gram suite × 2 stores × 2 flavours, specifics, and every earlier suite.

- [ ] **Step 6: README + changesets**

`packages/indexer-sqlite/README.md` (package shape, claim headings), covering:

- *What it is* — an `Indexer` whose FTS5, vector and n-gram/grep sub-indexes live in one SQLite `Db` (`node:sqlite`, sqlite-wasm in a worker, a Durable Object's `ctx.storage.sql`).
- *Why it exists* — one file holds every modality, survives restarts without a save step, and runs inside a Durable Object where only SQLite storage persists.
- *How to use* — `createSqliteIndexer({ db, providers: [newSqliteFullTextProvider(), newSqliteVectorProvider(), newSqliteNgramProvider()] })`; the indexer never closes `db`.
- *Examples* — Node: `newNodeSqliteDb({ path })`; DO: `newDoSqliteDb(ctx.storage)`; create an index with `fulltext` + `vector` + `ngram`, ingest, fused `SearchRequest`, `grep(index, "code", "fooBar\\(")`.
- *Internals*:
  - Tables: `__indexer_manifest`, `idx_<index>__blocks`, per sub-index `idx_<index>__<sub>_fts` / `_vec_*` / `_ng_*`. Vector and n-gram size and listing join the engine's own id table, so nothing can list a block the engine does not hold.
  - Why integer ids: engines work on ids; `{path, blockId}` rows are kept until `deleteIndex`, so an id is stable for its block.
  - Why `substr` and not `LIKE` for path scope (case and DO `PRAGMA`).
  - FTS: porter only for `en`; quoted OR words; SUM merge across `queries` — so it ranks a block matching more queries higher, where the PGlite and DuckDB backends keep the best single query.
  - Vector: cosine; `score = 1 − distance`.
  - N-gram: score = count; `caseSensitive` defaults to `true`.
- *What breaks* (exact symptoms):
  - A wrapped `Db` loses the transaction hook: the first write of any sub-index rejects with `inTransaction: this Db has no SQLite transaction hook. …` (db-sqlite's message, quoted in full).
  - Calling an engine-backed sub-index from inside your own `inTransaction` callback hangs on Node/browser (the engine's own transaction waits for yours).
  - A grep whose candidates exceed the budget returns `truncated: true` with partial hits.
  - Inside a DO, a write longer than ~15 s is retried.
- *Dependencies* — `db-api`, `db-sqlite`, `db-sqlite-index`, `indexer-api`, `indexer-core`, `indexer-fulltext`, `indexer-vector`, `indexer-ngram`.
- *License* — MIT.

Run every command shown in the README before committing.

`.changeset/indexer-sqlite.md`:

```md
---
"@statewalker/indexer-sqlite": minor
---

New SQLite indexer: FTS5, vector and n-gram/grep sub-indexes in one `@statewalker/db-api` `Db`, on Node, in a browser worker and in Durable Objects.
```

`.changeset/indexer-tests-ngram-suite.md`:

```md
---
"@statewalker/indexer-tests": minor
---

Add `runNgramConformanceSuite`, an Indexer-driven suite for the n-gram / grep modality.
```

- [ ] **Step 7: Whole-repo checks and commit**

```bash
pnpm test && pnpm typecheck && pnpm biome check --write --unsafe .
git add packages/indexer-tests packages/indexer-sqlite .changeset pnpm-lock.yaml
git commit -m "feat(indexer-sqlite): n-gram provider, n-gram conformance suite, README"
```

Expected: every package green; `indexer-pglite`, `indexer-duckdb`, `indexer-mem*` suites unchanged and passing.

---

## Contract issues for P1–P3 — resolved

All seven were reconciled into the P1–P3 plans: `getVectors`, `idTable` and `dropVectorIndex` are in P2 Task 2 (float32 always stored); `getTexts`, `idTable` and the store-agnostic `drop()` are in P3 Task 3; engine transactions are engine-owned (P2/P3 Global Constraints); offsets and defaults are as stated under "Consumed contracts"; `newFakeDoStorage` is at `@statewalker/db-sqlite-do/fake` and `newDoSqliteDb` is synchronous (P1 Task 3); catalog versions match P1's changesets (`db-sqlite`, `db-sqlite-do`, `db-pglite`, `db-sqlite-index` new at 0.1.0; `db-sqlite-node` 0.3.0).

## Self-review

- **Spec coverage:** D5 indexer side → Task 1. D6 (own kernel, `SqliteModalityProvider.open/drop`, manifest, shared blocks table, `createCompositeIndex`) → Task 3. D9 (no new vector contract) → Task 5 reuses `indexer-vector`. D10 (types, `newNgramAccess`, `grep`, matches within a block) → Task 2 + the cross-block case in Task 6. D13 (tokenizers, quoted OR, `-bm25`, SUM, snippet, `?` path scope) → Task 4. D14 indexer suites: kernel, RRF, multi-instance, fulltext, multi-word, vector, new n-gram; pglite unchanged — Tasks 1, 4, 5, 6, on node:sqlite and fake DO storage. `createSqlIndexer` untouched — no task modifies `indexer-core`.
- **Not in this plan:** a real `celld dev` run of `indexer-sqlite` (the engines and the Db have smoke scenarios in P1–P3's `test:do`), the flagged FTS max-vs-sum inconsistency in pglite/duckdb, and `Indexer.flush` → `db.flush`.
- **Placeholders:** none; every code step carries code.
- **Type consistency:** `BlockIds.ensure/select/refs(db, …)`, `newEnumeration(db, blockIds, sql)`, `SqliteModalityContext {db, prefix, blockIds}`, `NgramIndex.search → AsyncGenerator<NgramResult, NgramSearchSummary | undefined>` are used with the same names in Tasks 3–6.
