/**
 * Minimal normalised async SQL client used by indexer-core's SQL retrievers.
 * Each backend wraps its native driver (e.g. `@statewalker/db-api` `Db` or `PGlite`) to satisfy this shape.
 */
export interface SqlDb {
  exec(sql: string): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}
