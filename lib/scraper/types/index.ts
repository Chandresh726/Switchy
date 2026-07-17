export type {
  Platform,
  TriggerSource,
  LocationType,
  EmploymentType,
  SeniorityLevel,
  ScrapeLogStatus,
  SessionStatus,
  MatcherStatus,
} from "./platform";

export {
  isPlatform,
  isTriggerSource,
  parseEmploymentType,
} from "./platform";

export type { ScrapedJob } from "./job";

export type {
  ScrapeOutcome,
  ScraperError,
  ScraperResult,
  FetchResult,
  BatchFetchResult,

  DeduplicationMatchReason,
  DeduplicationResult,
  BatchDeduplicationResult,
  EarlyFilterStats,
} from "./result";

export {
  createScraperError,
  createScraperFailure,
  FetchResultSchema,
} from "./result";

export {
  ScraperPayloadError,
  parseExternalPayload,
  parseExternalItems,
  createFailureFromUnknown,
} from "./validation";

export type {
  JobFilters,
  ScrapeOptions,
  ApiScraperConfig,
  BrowserScraperConfig,
} from "./config";
