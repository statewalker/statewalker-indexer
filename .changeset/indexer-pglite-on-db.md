---
"@statewalker/indexer-pglite": minor
---

`createPGLiteIndexer({ db })` now takes a `@statewalker/db-api` `Db` (from `@statewalker/db-pglite`) instead of a `PGlite`. The caller loads the vector extension and owns the database: the indexer no longer creates or closes it. Breaking.

Migration (`newPgliteDb` from `@statewalker/db-pglite`, `vector` from `@electric-sql/pglite-pgvector`):

- `createPGLiteIndexer()` (implicit in-memory PGlite that the indexer closed) becomes
  `const db = await newPgliteDb({ extensions: { vector } }); const indexer = await createPGLiteIndexer({ db });`.
  Close the db yourself after `indexer.close()`.
- `createPGLiteIndexer({ db: pglite })` can no longer take an existing PGlite instance. Reopen it through
  `newPgliteDb({ path, extensions: { vector } })`, with `path` where you used `dataDir`.
