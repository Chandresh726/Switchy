export { getMatcherConfig, getDefaultConfig, validateMatcherConfig } from "./config";

export {
  fetchProfileData,
  fetchJobsData,
  persistMatchSuccess,
  getUnmatchedJobCount,
  getUnmatchedJobIds,
  logMatchFailure,
  getMatchSessionStatus,
} from "./tracking";

export { extractRequirements, htmlToText, chunkArray } from "./utils";

export {
  getCurrentMatchContext,
  getMatchPresentations,
  getMatchPresentationsForJobIds,
  getFreshUnmatchedJobCount,
  getFreshUnmatchedJobIds,
  type CurrentMatchContext,
  type MatchPresentation,
} from "./presentation";

export type {
  MatchResult,
  MatcherConfig,
  MatchResultMap,
  StrategyProgressCallback,
  ProfileData,
  JobData,
} from "./types";

export {
  MatchResultSchema,
  DEFAULT_MATCHER_CONFIG,
} from "./types";
