export type {
  Platform,
  TriggerSource,
  JobStatus,
  LocationType,
  DescriptionFormat,
  EmploymentType,
  SeniorityLevel,
  ScrapeLogStatus,
  SessionStatus,
  MatcherStatus,
  MatcherErrorType,
} from "./platform";

export {
  PLATFORMS,
  TRIGGER_SOURCES,
  JOB_STATUSES,
  LOCATION_TYPES,
  DESCRIPTION_FORMATS,
  EMPLOYMENT_TYPES,
  SENIORITY_LEVELS,
  isPlatform,
  isTriggerSource,
  isJobStatus,
  isLocationType,
  isDescriptionFormat,
  isEmploymentType,
  parseEmploymentType,
} from "./platform";

export type {
  ScrapedJob,
  ExistingJob,
  JobInsert,
} from "./job";

export { toJobInsert } from "./job";

export type {
  ScraperErrorCode,
  ScraperError,
  ScraperMetadata,
  ScraperResult,
  FetchResult,
  BatchFetchResult,
  SessionProgress,
  DeduplicationResult,
  BatchDeduplicationResult,
  EarlyFilterStats,
} from "./result";

export {
  createScraperError,
} from "./result";

export type {
  JobFilters,
  ScrapeOptions,
  ScraperConfig,
  ApiScraperConfig,
  BrowserScraperConfig,
} from "./config";

export {
  DEFAULT_SCRAPER_CONFIG,
  DEFAULT_API_CONFIG,
  DEFAULT_BROWSER_CONFIG,
} from "./config";

export type {
  MatchReason,
  SkillMatch,
  Recommendation,
} from "./schemas";

export {
  MatchReasonSchema,
  SkillMatchSchema,
  RecommendationSchema,
  MatchReasonsArraySchema,
  SkillsArraySchema,
  RecommendationsArraySchema,
  parseMatchReasons,
  parseMatchedSkills,
  parseMissingSkills,
  parseRecommendations,
  serializeMatchReasons,
  serializeSkills,
  serializeStringArray,
  serializeRecommendations,
} from "./schemas";
