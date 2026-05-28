import type {
  CreateIndexParams,
  Index,
  SearchRequest,
  SearchResult,
} from "@statewalker/indexer-api";
import { getSubQuery, getSubResult, setSubQuery } from "@statewalker/indexer-api";
import { getVectorConfig, setVectorConfig } from "./config.js";
import type { VectorConfig, VectorIndex, VectorQuery, VectorResult } from "./types.js";

/** User-facing typed bundle bound to one vector sub-index **name**. */
export interface VectorAccess {
  readonly name: string;
  /** Throws if no sub-index named `name` is registered on `index`. */
  get(index: Index): VectorIndex;
  /** Returns `undefined` instead of throwing — for probing. */
  tryGet(index: Index): VectorIndex | undefined;

  setConfig(params: CreateIndexParams, config: VectorConfig): void;
  getConfig(params: CreateIndexParams): VectorConfig | undefined;

  setQuery(request: SearchRequest, query: VectorQuery): void;
  getQuery(request: SearchRequest): VectorQuery | undefined;

  getResult(entry: SearchResult): VectorResult | undefined;
}

/** Construct a name-bound {@link VectorAccess} handle. */
export function newVectorAccess(name: string): VectorAccess {
  return {
    name,
    get(index: Index): VectorIndex {
      const binding = index.getBinding(name);
      if (!binding) {
        throw new Error(`No sub-index named "${name}" is registered on index "${index.name}"`);
      }
      return binding.index as VectorIndex;
    },
    tryGet(index: Index): VectorIndex | undefined {
      return (index.getBinding(name)?.index as VectorIndex | undefined) ?? undefined;
    },
    setConfig(params: CreateIndexParams, config: VectorConfig): void {
      setVectorConfig(params, name, config);
    },
    getConfig(params: CreateIndexParams): VectorConfig | undefined {
      return getVectorConfig(params, name);
    },
    setQuery(request: SearchRequest, query: VectorQuery): void {
      setSubQuery<VectorQuery>(request, name, query);
    },
    getQuery(request: SearchRequest): VectorQuery | undefined {
      return getSubQuery<VectorQuery>(request, name);
    },
    getResult(entry: SearchResult): VectorResult | undefined {
      return getSubResult<VectorResult>(entry, name);
    },
  };
}
