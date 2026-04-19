export { indexDocuments } from "./index-documents.js";
export {
  createMockCitationBuilder,
  createMockExpander,
  createMockReranker,
} from "./mock.js";
export type {
  EntryExplain,
  PipelineConfig,
  PipelineEntry,
} from "./search-pipeline.js";
export { SearchPipeline } from "./search-pipeline.js";
export type {
  Citation,
  CitationBuilderFn,
  ExpandedQuery,
  QueryExpanderFn,
  RerankerFn,
  RerankResult,
} from "./types.js";
