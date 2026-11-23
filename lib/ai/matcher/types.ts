export interface MatchResult {
  score: number;
  reasons: string[];
  matchedSkills: string[];
}

import type { MatchFallbackModel } from "./fallback";

export interface MatcherConfig {
  jobAnalysisFallback?: MatchFallbackModel;
  matchFallback?: MatchFallbackModel;
  jobAnalysisModel?: string;
  jobAnalysisProviderId?: string;
  jobAnalysisReasoningEffort?: string;
  model: string;
  providerId?: string;
  reasoningEffort?: string;
  batchSize: number;
  maxRetries: number;
  concurrencyLimit: number;
  timeoutMs: number;
  backoffBaseDelay: number;
  backoffMaxDelay: number;
  autoMatchAfterScrape: boolean;
}

export const DEFAULT_MATCHER_CONFIG: MatcherConfig = {
  jobAnalysisModel: "",
  jobAnalysisReasoningEffort: "",
  model: "",
  reasoningEffort: "",
  batchSize: 2,
  maxRetries: 3,
  concurrencyLimit: 3,
  timeoutMs: 120000,
  backoffBaseDelay: 2000,
  backoffMaxDelay: 32000,
  autoMatchAfterScrape: true,
};

export type MatchResultMap = Map<number, MatchResult | Error>;

export type StrategyProgressCallback = (
  completed: number,
  total: number,
  succeeded: number,
  failed: number
) => void;

export interface JobData {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  locationType: string | null;
  salary: string | null;
  department: string | null;
  employmentType: string | null;
  seniorityLevel: string | null;
}
