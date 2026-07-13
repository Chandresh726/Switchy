export type {
  IDeduplicationService,
  DeduplicationConfig,
} from "./deduplication-service";

export {
  TitleBasedDeduplicationService,
  createDeduplicationService,
  DEFAULT_DEDUPLICATION_CONFIG,
} from "./deduplication-service";

export type {
  IFilterService,
  JobFilters,
  FilterResult,
} from "./filter-service";

export {
  DefaultFilterService,
  createFilterService,
} from "./filter-service";

export type {
  FilterableItem,
  EarlyFilterBreakdown,
  EarlyFilterResult,
} from "./early-filter-service";

export {
  hasEarlyFilters,
  applyEarlyFilters,
  toEarlyFilterStats,
} from "./early-filter-service";

export type {
  IScraperRegistry,
  ScraperRegistryConfig,
} from "./registry";

export {
  ScraperRegistry,
  createScraperRegistry,
} from "./registry";
