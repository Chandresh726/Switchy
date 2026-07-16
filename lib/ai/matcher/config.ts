import { inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import {
  type MatcherConfig,
  DEFAULT_MATCHER_CONFIG,
} from "./types";

const MATCHER_SETTING_KEYS = [
  "matcher_model",
  "matcher_provider_id",
  "matcher_reasoning_effort",
  "job_analysis_model",
  "job_analysis_provider_id",
  "job_analysis_reasoning_effort",
  "matcher_batch_size",
  "matcher_max_retries",
  "matcher_concurrency_limit",
  "matcher_timeout_ms",
  "matcher_backoff_base_delay",
  "matcher_backoff_max_delay",
  "matcher_auto_match_after_scrape",
] as const;

function parseBoolean(value: string | null | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue;
  return value === "true";
}

function parseNumber(value: string | null | undefined, defaultValue: number): number {
  if (value === undefined || value === null) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export async function getMatcherConfig(): Promise<MatcherConfig> {
  const dbSettings = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, MATCHER_SETTING_KEYS));

  const settingsMap = new Map(dbSettings.map((s) => [s.key, s.value]));

  const storedProviderId = settingsMap.get("matcher_provider_id") || undefined;
  const storedModelId = settingsMap.get("matcher_model") || undefined;

  return {
    providerId: storedProviderId,
    model: storedModelId ?? "",
    reasoningEffort:
      settingsMap.get("matcher_reasoning_effort") ||
      DEFAULT_MATCHER_CONFIG.reasoningEffort,
    jobAnalysisProviderId:
      settingsMap.get("job_analysis_provider_id") || storedProviderId,
    jobAnalysisModel:
      settingsMap.get("job_analysis_model") || storedModelId || "",
    jobAnalysisReasoningEffort:
      settingsMap.get("job_analysis_reasoning_effort") ||
      settingsMap.get("matcher_reasoning_effort") ||
      DEFAULT_MATCHER_CONFIG.jobAnalysisReasoningEffort,
    batchSize: parseNumber(
      settingsMap.get("matcher_batch_size"),
      DEFAULT_MATCHER_CONFIG.batchSize
    ),
    maxRetries: parseNumber(
      settingsMap.get("matcher_max_retries"),
      DEFAULT_MATCHER_CONFIG.maxRetries
    ),
    concurrencyLimit: parseNumber(
      settingsMap.get("matcher_concurrency_limit"),
      DEFAULT_MATCHER_CONFIG.concurrencyLimit
    ),
    timeoutMs: parseNumber(
      settingsMap.get("matcher_timeout_ms"),
      DEFAULT_MATCHER_CONFIG.timeoutMs
    ),
    backoffBaseDelay: parseNumber(
      settingsMap.get("matcher_backoff_base_delay"),
      DEFAULT_MATCHER_CONFIG.backoffBaseDelay
    ),
    backoffMaxDelay: parseNumber(
      settingsMap.get("matcher_backoff_max_delay"),
      DEFAULT_MATCHER_CONFIG.backoffMaxDelay
    ),
    autoMatchAfterScrape: parseBoolean(
      settingsMap.get("matcher_auto_match_after_scrape"),
      DEFAULT_MATCHER_CONFIG.autoMatchAfterScrape
    ),
  };
}

export function getDefaultConfig(): MatcherConfig {
  return { ...DEFAULT_MATCHER_CONFIG };
}

export function validateMatcherConfig(
  config: Partial<MatcherConfig>
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.batchSize !== undefined) {
    if (config.batchSize < 1 || config.batchSize > 10) {
      errors.push("Batch size must be between 1 and 10");
    }
  }

  if (config.maxRetries !== undefined) {
    if (config.maxRetries < 1 || config.maxRetries > 10) {
      errors.push("Max attempts must be between 1 and 10");
    }
  }

  if (config.concurrencyLimit !== undefined) {
    if (config.concurrencyLimit < 1 || config.concurrencyLimit > 10) {
      errors.push("Concurrency limit must be between 1 and 10");
    }
  }

  if (config.timeoutMs !== undefined) {
    if (config.timeoutMs < 5000 || config.timeoutMs > 120000) {
      errors.push("Timeout must be between 5s and 120s");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
