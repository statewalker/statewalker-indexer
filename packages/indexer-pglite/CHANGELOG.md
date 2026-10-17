# @statewalker/indexer-pglite

## 0.3.0

### Minor Changes

- dedfa8d: `createPGLiteIndexer({ db })` now takes a `@statewalker/db-api` `Db` (from `@statewalker/db-pglite`) instead of a `PGlite`. The caller loads the vector extension and owns the database: the indexer no longer creates or closes it. `@electric-sql/pglite` and `@electric-sql/pglite-pgvector` are no longer dependencies; install `@statewalker/db-pglite` and `@electric-sql/pglite-pgvector` yourself. Breaking.
  
  Migration:
  
  ```ts
  import { vector } from "@electric-sql/pglite-pgvector";
  import { newPgliteDb } from "@statewalker/db-pglite";
  import { createPGLiteIndexer } from "@statewalker/indexer-pglite";
  
  // was: createPGLiteIndexer()  (in-memory; the indexer closed the PGlite)
  const db = await newPgliteDb({ extensions: { vector } });
  
  // was: createPGLiteIndexer({ db: await PGlite.create({ dataDir, extensions: { vector } }) })
  // An existing PGlite instance can no longer be passed; use `path` where you used `dataDir`:
  // const db = await newPgliteDb({ path: dataDir, extensions: { vector } });
  
  const indexer = await createPGLiteIndexer({ db });
  // ...
  await indexer.close();
  await db.close(); // the indexer no longer closes the database
  ```

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @statewalker/indexer-api@0.1.3
  - @statewalker/indexer-fulltext@0.1.3
  - @statewalker/indexer-vector@0.1.3

## 0.2.2

### Patch Changes

- Release of the changes since the last published version:
  
  - files changed: README.md
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @statewalker/indexer-api@0.1.2
  - @statewalker/indexer-core@0.1.2
  - @statewalker/indexer-fulltext@0.1.2
  - @statewalker/indexer-vector@0.1.2
