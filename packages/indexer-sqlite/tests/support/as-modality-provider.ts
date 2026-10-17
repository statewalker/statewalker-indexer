import type { Db } from "@statewalker/db-api";
import type { ModalityProvider, ScoredHit, SearchIndex } from "@statewalker/indexer-api";
import { createSqliteIndexer, type SqliteModalityProvider } from "../../src/index.js";

type Fn = (...args: unknown[]) => unknown;
const CALLS = [
  "getIndexInfo",
  "addDocument",
  "addDocuments",
  "deleteDocuments",
  "getSize",
  "close",
  "flush",
  "deleteIndex",
];
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
