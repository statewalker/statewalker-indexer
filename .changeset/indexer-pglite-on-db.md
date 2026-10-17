---
"@statewalker/indexer-pglite": minor
---

`createPGLiteIndexer({ db })` now takes a `@statewalker/db-api` `Db` (from `@statewalker/db-pglite`) instead of a `PGlite`. The caller loads the vector extension and owns the database: the indexer no longer creates or closes it. Breaking.

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
