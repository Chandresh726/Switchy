import type { LanguageModel } from "ai";

import type { AIProvider } from "@/lib/ai/providers/types";

export type AICapability =
  | "job_analysis"
  | "match_adjudication"
  | "writing_cover_letter"
  | "writing_referral"
  | "writing_recruiter_follow_up"
  | "resume_parse";

export interface AIExecutionPolicy {
  maxAttempts: number;
  timeoutMs: number;
  reasoningEffort: "low" | "medium" | "high";
  maxOutputTokens?: number;
}

export interface ResolvedModelSnapshot {
  providerRecordId: string;
  provider: AIProvider;
  modelId: string;
  model: LanguageModel;
  providerOptions?: Record<string, unknown>;
}

export interface AIExecutionUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AIExecutionResult<T> {
  output: T;
  runId: string;
  usage: AIExecutionUsage;
  durationMs: number;
  finishReason?: string;
  attempts: number;
}

export interface AIExecutionVersions {
  prompt: string;
  schema: string;
  policy: string;
}

export interface AIExecutionSubject {
  type: string;
  id: string;
}

export type SafeAIMetadataValue = string | number | boolean | null;
export type SafeAIMetadata = Record<string, SafeAIMetadataValue>;

export type AIRunCacheStatus = "miss" | "hit" | "bypass";
export type AIRunQualityResult = "not_checked" | "passed" | "failed";
