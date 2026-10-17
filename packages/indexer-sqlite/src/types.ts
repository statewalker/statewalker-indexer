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
