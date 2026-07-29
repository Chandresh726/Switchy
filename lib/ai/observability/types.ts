interface AIRunAttemptSummary {
  attemptNumber: number;
  status: string;
  inputTokens: number | null;
  inputNoCacheTokens: number | null;
  inputCacheReadTokens: number | null;
  inputCacheWriteTokens: number | null;
  outputTokens: number | null;
  outputTextTokens: number | null;
  outputReasoningTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  finishReason: string | null;
  providerRequestId: string | null;
  warningCodes: string[];
  errorCode: string | null;
  retryDelayMs: number | null;
  startedAt: string;
  completedAt: string | null;
}

export interface AIRunSummary {
  id: string;
  capability: string;
  provider: string;
  modelId: string;
  status: string;
  attempts: number;
  inputTokens: number | null;
  inputNoCacheTokens: number | null;
  inputCacheReadTokens: number | null;
  inputCacheWriteTokens: number | null;
  outputTokens: number | null;
  outputTextTokens: number | null;
  outputReasoningTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  finishReason: string | null;
  providerRequestId: string | null;
  providerConfigFingerprint: string | null;
  cacheStatus: string;
  qualityResult: string;
  warningCodes: string[];
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
  attemptHistory: AIRunAttemptSummary[];
}

export interface AIUsageCapabilitySummary {
  capability: string;
  executions: number;
  calls: number;
  succeeded: number;
  failed: number;
  abandoned: number;
  cacheHits: number;
  tokenTrackedExecutions: number;
  totalTokens: number;
  averageLatencyMs: number;
}

export interface AIUsageProviderSummary {
  provider: string;
  modelId: string;
  executions: number;
  calls: number;
  succeeded: number;
  failed: number;
  abandoned: number;
  totalTokens: number;
}

export type AIUsagePeriod = 7 | 30 | "all";

interface AIUsageFailureSummary {
  code: string;
  count: number;
}

export interface AIUsageSummary {
  days: AIUsagePeriod;
  periodStart: string;
  periodEnd: string;
  executions: number;
  calls: number;
  succeeded: number;
  failed: number;
  running: number;
  cancelled: number;
  abandoned: number;
  successRate: number;
  terminalExecutions: number;
  tokenTrackedExecutions: number;
  tokenCoveragePercent: number;
  inputTokens: number;
  inputNoCacheTokens: number;
  inputCacheReadTokens: number;
  inputCacheWriteTokens: number;
  outputTokens: number;
  outputTextTokens: number;
  outputReasoningTokens: number;
  totalTokens: number;
  averageLatencyMs: number;
  cacheHits: number;
  /** Matching-only signal; absent when the summary is scoped to another group. */
  fullMatchCacheReuses?: number;
  capabilities: AIUsageCapabilitySummary[];
  providers: AIUsageProviderSummary[];
  failures: AIUsageFailureSummary[];
}
