// Re-export all matcher types
export * from "./types";

// Re-export settings functionality
export { getMatcherSettings, parseMatcherSetting, validateMatcherSettings } from "./settings";

// Re-export generation utilities
export { generateStructured, generateSimpleText, USE_GENERATE_OBJECT, JSON_PROMPT_SUFFIX } from "./generation";

// Re-export single job matching
export { calculateJobMatch } from "./single";

// Re-export bulk matching
export { bulkCalculateJobMatches, batchCalculateJobMatches } from "./bulk";

// Re-export tracking and session management
export {
  matchJobsWithTracking,
  matchUnmatchedJobs,
  matchUnmatchedJobsWithTracking,
  getUnmatchedJobIds,
} from "./tracking";

// Re-export utilities
export { extractRequirements, htmlToText, chunkArray } from "./utils";

// Re-export error handling
export { categorizeError, isRetryableError, createMatcherError } from "./errors";
