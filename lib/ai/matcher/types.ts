import { z } from "zod";

/**
 * Match result schema for single job matching
 */
export const MatchResultSchema = z.object({
  score: z.number().min(0).max(100),
  reasons: z.array(z.string()),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  recommendations: z.array(z.string()),
});

export type MatchResult = z.infer<typeof MatchResultSchema>;

/**
 * Schema for bulk match results - single job within array
 */
export const BulkMatchItemSchema = z.object({
  jobId: z.number(),
  score: z.number().min(0).max(100),
  reasons: z.array(z.string()),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  recommendations: z.array(z.string()),
});

export type BulkMatchResult = z.infer<typeof BulkMatchItemSchema>;

/**
 * Schema for bulk match results array
 */
export const BulkMatchResultSchema = z.array(BulkMatchItemSchema);

/**
 * Error type categorization for matcher errors
 */
export type ErrorType =
  | "network"
  | "validation"
  | "rate_limit"
  | "json_parse"
  | "no_object"
  | "timeout"
  | "circuit_breaker"
  | "unknown";

/**
 * Matcher settings from database
 */
export interface MatcherSettings {
  model: string;
  reasoningEffort: string;
  bulkEnabled: boolean;
  batchSize: number;
  maxRetries: number;
  concurrencyLimit: number;
  timeoutMs: number;
  backoffBaseDelay: number;
  backoffMaxDelay: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetTimeout: number;
  autoMatchAfterScrape: boolean;
}

/**
 * Default matcher settings
 */
export const DEFAULT_MATCHER_SETTINGS: MatcherSettings = {
  model: "gemini-3-flash-preview",
  reasoningEffort: "medium",
  bulkEnabled: true,
  batchSize: 2,
  maxRetries: 3,
  concurrencyLimit: 3,
  timeoutMs: 30000,
  backoffBaseDelay: 2000,
  backoffMaxDelay: 32000,
  circuitBreakerThreshold: 10,
  circuitBreakerResetTimeout: 60000,
  autoMatchAfterScrape: true,
};

/**
 * Options for matching operations
 */
export interface MatchOptions {
  scrapingLogId?: number | null;
  sessionId?: string;
}

/**
 * Job data structure for matching prompts
 */
export interface JobForMatching {
  id: number;
  title: string;
  description: string;
  requirements: string[];
}

/**
 * Candidate profile structure for matching prompts
 */
export interface CandidateProfile {
  summary?: string;
  skills: { name: string; proficiency: number; category?: string }[];
  experience: { title: string; company: string; description?: string }[];
}

/**
 * Match session tracking result
 */
export interface MatchSessionResult {
  sessionId: string;
  total: number;
  succeeded: number;
  failed: number;
}

/**
 * Progress callback type
 */
export type MatchProgressCallback = (
  completed: number,
  total: number,
  succeeded?: number,
  failed?: number
) => void;

/**
 * Database job schema (partial, for type safety)
 */
export interface JobData {
  id: number;
  title: string;
  description: string | null;
  cleanDescription: string | null;
}

/**
 * Database profile schema (partial, for type safety)
 */
export interface ProfileData {
  id: number;
  summary: string | null;
}

/**
 * Database skill schema (partial, for type safety)
 */
export interface SkillData {
  profileId: number;
  name: string;
  proficiency: number;
  category: string | null;
}

/**
 * Database experience schema (partial, for type safety)
 */
export interface ExperienceData {
  profileId: number;
  title: string;
  company: string;
  description: string | null;
}
