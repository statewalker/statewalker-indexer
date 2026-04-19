import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES_DIR = fileURLToPath(new URL(".", import.meta.url));

export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 256;

export interface BlockFixture {
  readonly text: string;
  readonly type: string;
  readonly embedding: number[];
}

export type BlocksFixture = Record<string, Record<string, BlockFixture>>;
export type QueriesEmbeddingsFixture = Record<string, number[]>;

export interface QueryFixture {
  id: string;
  query: string;
  expectedTopPath: string;
  expectedTopics: string[];
}

let cachedBlocks: BlocksFixture | undefined;
let cachedQueriesEmbeddings: QueriesEmbeddingsFixture | undefined;
let cachedQueries: QueryFixture[] | undefined;

export function loadBlocksFixture(): BlocksFixture {
  if (!cachedBlocks) {
    cachedBlocks = JSON.parse(
      readFileSync(join(FIXTURES_DIR, "embeddings/blocks.json"), "utf-8"),
    ) as BlocksFixture;
  }
  return cachedBlocks;
}

export function loadQueriesEmbeddingsFixture(): QueriesEmbeddingsFixture {
  if (!cachedQueriesEmbeddings) {
    cachedQueriesEmbeddings = JSON.parse(
      readFileSync(join(FIXTURES_DIR, "embeddings/queries.json"), "utf-8"),
    ) as QueriesEmbeddingsFixture;
  }
  return cachedQueriesEmbeddings;
}

export function loadQueriesFixture(): QueryFixture[] {
  if (!cachedQueries) {
    cachedQueries = JSON.parse(
      readFileSync(join(FIXTURES_DIR, "queries/queries.json"), "utf-8"),
    ) as QueryFixture[];
  }
  return cachedQueries;
}

export function readFixtureDoc(name: string): string {
  return readFileSync(join(FIXTURES_DIR, "documents", name), "utf-8");
}

export function listFixtureDocs(): string[] {
  return readdirSync(join(FIXTURES_DIR, "documents"))
    .filter((f) => f.endsWith(".md"))
    .sort();
}
