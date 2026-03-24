import type { Index } from "./indexer-index.js";
import type { Metadata } from "./types.js";

export interface CreateIndexParams {
  name: string;
  fulltext?: { language: string; metadata?: Metadata };
  vector?: { dimensionality: number; model: string; metadata?: Metadata };
  overwrite?: boolean;
}

export interface IndexInfo {
  name: string;
  metadata?: Metadata;
}

export interface Indexer {
  getIndexNames(): Promise<IndexInfo[]>;
  createIndex(params: CreateIndexParams): Promise<Index>;
  getIndex(name: string): Promise<Index | null>;
  hasIndex(name: string): Promise<boolean>;
  deleteIndex(name: string): Promise<void>;
  close(): Promise<void>;
}
