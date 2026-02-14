import { z } from "zod";

export const MatchResultSchema = z.object({
  score: z.number().min(0).max(100),
  reasons: z.array(z.string()),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  recommendations: z.array(z.string()),
});

export type MatchResult = z.infer<typeof MatchResultSchema>;

export const BulkMatchItemSchema = z.object({
  jobId: z.number(),
  score: z.number().min(0).max(100),
  reasons: z.array(z.string()),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  recommendations: z.array(z.string()),
});

export type BulkMatchResult = z.infer<typeof BulkMatchItemSchema>;

export const BulkMatchResultSchema = z.object({
  results: z.array(BulkMatchItemSchema),
});

export type ErrorType =
  | "network"
  | "validation"
  | "rate_limit"
  | "json_parse"
  | "no_object"
  | "timeout"
  | "circuit_breaker"
  | "unknown";

export type TriggerSource = "manual" | "scheduler" | "company_refresh";

export type MatchPhase = "queued" | "matching" | "completed";

export interface MatcherConfig {
  model: string;
  reasoningEffort: string;
  bulkEnabled: boolean;
  batchSize: number;
  maxRetries: number;
  concurrencyLimit: number;
  serializeOperations: boolean;
  interRequestDelayMs: number;
  timeoutMs: number;
  backoffBaseDelay: number;
  backoffMaxDelay: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetTimeout: number;
  autoMatchAfterScrape: boolean;
}

export const DEFAULT_MATCHER_CONFIG: MatcherConfig = {
  model: "gemini-3-flash-preview",
  reasoningEffort: "medium",
  bulkEnabled: true,
  batchSize: 2,
  maxRetries: 3,
  concurrencyLimit: 3,
  serializeOperations: false,
  interRequestDelayMs: 500,
  timeoutMs: 30000,
  backoffBaseDelay: 2000,
  backoffMaxDelay: 32000,
  circuitBreakerThreshold: 10,
  circuitBreakerResetTimeout: 60000,
  autoMatchAfterScrape: true,
};

export const PROVIDER_DEFAULTS: Record<string, Partial<MatcherConfig>> = {
  modal: {
    concurrencyLimit: 1,
    serializeOperations: true,
    interRequestDelayMs: 1000,
    timeoutMs: 90000,
    backoffBaseDelay: 3000,
    backoffMaxDelay: 60000,
    circuitBreakerThreshold: 5,
  },
};

export interface MatchJob {
  id: number;
  title: string;
  description: string;
  requirements: string[];
}

export interface CandidateProfile {
  name?: string;
  summary?: string;
  skills: Array<{ name: string; proficiency: number; category?: string }>;
  experience: Array<{ title: string; company: string; description?: string }>;
}

export interface MatchProgress {
  phase: MatchPhase;
  queuePosition: number;
  completed: number;
  total: number;
  succeeded: number;
  failed: number;
}

export type MatchProgressCallback = (progress: MatchProgress) => void;

export interface MatchOptions {
  triggerSource?: TriggerSource;
  companyId?: number;
  sessionId?: string;
  onProgress?: MatchProgressCallback;
}

export interface MatchSessionResult {
  sessionId: string;
  total: number;
  succeeded: number;
  failed: number;
}

export type MatchResultMap = Map<number, MatchResult | Error>;

export interface StrategyResultItem {
  result?: MatchResult;
  error?: Error;
  duration: number;
}

export type StrategyResultMap = Map<number, StrategyResultItem>;

export type MatchStrategy = "single" | "bulk" | "parallel";

export interface ProfileData {
  profile: { id: number; summary: string | null };
  skills: Array<{ name: string; proficiency: number; category: string | null }>;
  experience: Array<{ title: string; company: string; description: string | null }>;
}

export interface JobData {
  id: number;
  title: string;
  description: string | null;
}
