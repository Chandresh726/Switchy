export interface AIRunSummary {
  id: string;
  capability: string;
  provider: string;
  modelId: string;
  status: string;
  attempts: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  finishReason: string | null;
  cacheStatus: string;
  qualityResult: string;
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface AIUsageCapabilitySummary {
  capability: string;
  executions: number;
  calls: number;
  succeeded: number;
  failed: number;
  totalTokens: number;
  averageLatencyMs: number;
}

export interface AIUsageFailureSummary {
  code: string;
  count: number;
}

export interface AIUsageSummary {
  days: 7 | 30;
  periodStart: string;
  periodEnd: string;
  executions: number;
  calls: number;
  succeeded: number;
  failed: number;
  running: number;
  cancelled: number;
  successRate: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  averageLatencyMs: number;
  fullMatchCacheReuses: number;
  capabilities: AIUsageCapabilitySummary[];
  failures: AIUsageFailureSummary[];
}
