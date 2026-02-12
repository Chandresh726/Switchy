export { createMatchEngine, matchSingle, matchBulk, matchWithTracking, matchUnmatchedJobs, type MatchEngine } from "./engine";

export { getMatcherConfig, getDefaultConfig, getProviderDefaults, validateMatcherConfig } from "./config";

export {
  getQueueStatus,
  getQueuePosition,
  withQueue,
  resetQueue,
  type QueueStatus,
  type QueuePositionCallback,
} from "./queue";

export {
  fetchProfileData,
  fetchJobsData,
  updateJobWithMatchResult,
  getUnmatchedJobIds,
  createMatchSession,
  updateMatchSession,
  logMatchSuccess,
  logMatchFailure,
  finalizeMatchSession,
  createProgressTracker,
  type ProgressTracker,
} from "./tracking";

export {
  CircuitBreaker,
  CircuitState,
  createCircuitBreaker,
  retryWithBackoff,
  withTimeout,
  categorizeError,
  isRetryableError,
  isServerError,
  isRateLimitError,
  createMatcherError,
  MatcherError,
  MatcherValidationError,
  MatcherProviderError,
  MatcherTimeoutError,
  type CircuitBreakerOptions,
  type RetryOptions,
} from "./resilience";

export {
  SINGLE_MATCH_SYSTEM_PROMPT,
  BULK_MATCH_SYSTEM_PROMPT,
  buildSingleMatchPrompt,
  buildBulkMatchPrompt,
} from "./prompts";

export { generateStructured } from "./generation";

export { extractRequirements, htmlToText, chunkArray } from "./utils";

export type {
  StrategyProgressCallback,
} from "./strategies";

export type {
  MatchResult,
  BulkMatchResult,
  MatcherConfig,
  MatchJob,
  CandidateProfile,
  MatchProgress,
  MatchProgressCallback,
  MatchOptions,
  MatchSessionResult,
  MatchResultMap,
  StrategyResultMap,
  MatchStrategy,
  TriggerSource,
  MatchPhase,
  ErrorType,
  ProfileData,
  JobData,
} from "./types";

export {
  MatchResultSchema,
  BulkMatchItemSchema,
  BulkMatchResultSchema,
  DEFAULT_MATCHER_CONFIG,
  PROVIDER_DEFAULTS,
} from "./types";
