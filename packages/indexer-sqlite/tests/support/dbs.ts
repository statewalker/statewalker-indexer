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
