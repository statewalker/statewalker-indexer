import type {
  CreateIndexParams,
  Index,
  SearchRequest,
  SearchResult,
} from "@statewalker/indexer-api";
import { getSubQuery, getSubResult, setSubQuery } from "@statewalker/indexer-api";
import { getNgramConfig, setNgramConfig } from "./config.js";
import type { NgramConfig, NgramIndex, NgramQuery, NgramResult } from "./types.js";

/** User-facing typed bundle bound to one n-gram sub-index **name**. */
export interface NgramAccess {
  readonly name: string;
  /** Throws if no sub-index named `name` is registered on `index`. */
  get(index: Index): NgramIndex;
  tryGet(index: Index): NgramIndex | undefined;
  setConfig(params: CreateIndexParams, config: NgramConfig): void;
  getConfig(params: CreateIndexParams): NgramConfig | undefined;
  setQuery(request: SearchRequest, query: NgramQuery): void;
  getQuery(request: SearchRequest): NgramQuery | undefined;
  getResult(entry: SearchResult): NgramResult | undefined;
}

export function newNgramAccess(name: string): NgramAccess {
  return {
    name,
    get(index: Index): NgramIndex {
      const binding = index.getBinding(name);
      if (!binding) {
        throw new Error(`No sub-index named "${name}" is registered on index "${index.name}"`);
      }
      return binding.index as NgramIndex;
    },
    tryGet: (index) => index.getBinding(name)?.index as NgramIndex | undefined,
    setConfig: (params, config) => setNgramConfig(params, name, config),
    getConfig: (params) => getNgramConfig(params, name),
    setQuery: (request, query) => setSubQuery<NgramQuery>(request, name, query),
    getQuery: (request) => getSubQuery<NgramQuery>(request, name),
    getResult: (entry) => getSubResult<NgramResult>(entry, name),
  };
}
