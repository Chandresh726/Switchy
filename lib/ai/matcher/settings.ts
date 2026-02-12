import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { getCurrentProvider } from "@/lib/ai/client";
import {
  type MatcherSettings,
  DEFAULT_MATCHER_SETTINGS,
} from "./types";

/**
 * Database keys for matcher settings
 */
const MATCHER_SETTING_KEYS = [
  "matcher_model",
  "matcher_reasoning_effort",
  "matcher_bulk_enabled",
  "matcher_batch_size",
  "matcher_max_retries",
  "matcher_concurrency_limit",
  "matcher_timeout_ms",
  "matcher_backoff_base_delay",
  "matcher_backoff_max_delay",
  "matcher_circuit_breaker_threshold",
  "matcher_circuit_breaker_reset_timeout",
  "matcher_auto_match_after_scrape",
] as const;

/**
 * Fetch matcher settings from database with defaults
 * @returns MatcherSettings with defaults applied for missing values
 */
export async function getMatcherSettings(): Promise<MatcherSettings> {
  const dbSettings = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, MATCHER_SETTING_KEYS));

  const settingsMap = new Map(dbSettings.map((s) => [s.key, s.value]));

  const currentProvider = await getCurrentProvider();
  const isModalProvider = currentProvider === "modal";

  return {
    model: settingsMap.get("matcher_model") || DEFAULT_MATCHER_SETTINGS.model,
    reasoningEffort:
      settingsMap.get("matcher_reasoning_effort") ||
      DEFAULT_MATCHER_SETTINGS.reasoningEffort,
    bulkEnabled:
      (settingsMap.get("matcher_bulk_enabled") ?? "true") === "true",
    batchSize: parseInt(
      settingsMap.get("matcher_batch_size") ||
        String(DEFAULT_MATCHER_SETTINGS.batchSize),
      10
    ),
    maxRetries: parseInt(
      settingsMap.get("matcher_max_retries") ||
        String(DEFAULT_MATCHER_SETTINGS.maxRetries),
      10
    ),
    concurrencyLimit: isModalProvider ? 1 : parseInt(
      settingsMap.get("matcher_concurrency_limit") ||
        String(DEFAULT_MATCHER_SETTINGS.concurrencyLimit),
      10
    ),
    timeoutMs: parseInt(
      settingsMap.get("matcher_timeout_ms") ||
        String(DEFAULT_MATCHER_SETTINGS.timeoutMs),
      10
    ),
    backoffBaseDelay: parseInt(
      settingsMap.get("matcher_backoff_base_delay") ||
        String(DEFAULT_MATCHER_SETTINGS.backoffBaseDelay),
      10
    ),
    backoffMaxDelay: parseInt(
      settingsMap.get("matcher_backoff_max_delay") ||
        String(DEFAULT_MATCHER_SETTINGS.backoffMaxDelay),
      10
    ),
    circuitBreakerThreshold: parseInt(
      settingsMap.get("matcher_circuit_breaker_threshold") ||
        String(DEFAULT_MATCHER_SETTINGS.circuitBreakerThreshold),
      10
    ),
    circuitBreakerResetTimeout: parseInt(
      settingsMap.get("matcher_circuit_breaker_reset_timeout") ||
        String(DEFAULT_MATCHER_SETTINGS.circuitBreakerResetTimeout),
      10
    ),
    autoMatchAfterScrape:
      (settingsMap.get("matcher_auto_match_after_scrape") ?? "true") === "true",
  };
}

/**
 * Parse a specific matcher setting with type safety
 */
export function parseMatcherSetting<T extends number | boolean | string>(
  value: string | undefined,
  defaultValue: T,
  type: "number" | "boolean" | "string"
): T {
  if (value === undefined) {
    return defaultValue;
  }

  switch (type) {
    case "number":
      const parsed = parseInt(value, 10);
      return (isNaN(parsed) ? defaultValue : parsed) as T;
    case "boolean":
      return ((value ?? "true") === "true" ? true : false) as T;
    case "string":
    default:
      return (value || defaultValue) as T;
  }
}

/**
 * Validate matcher settings and return any errors
 */
export function validateMatcherSettings(
  settings: Partial<MatcherSettings>
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (settings.batchSize !== undefined) {
    if (settings.batchSize < 1 || settings.batchSize > 10) {
      errors.push("Batch size must be between 1 and 10");
    }
  }

  if (settings.maxRetries !== undefined) {
    if (settings.maxRetries < 1 || settings.maxRetries > 5) {
      errors.push("Max retries must be between 1 and 5");
    }
  }

  if (settings.concurrencyLimit !== undefined) {
    if (settings.concurrencyLimit < 1 || settings.concurrencyLimit > 10) {
      errors.push("Concurrency limit must be between 1 and 10");
    }
  }

  if (settings.timeoutMs !== undefined) {
    if (settings.timeoutMs < 5000 || settings.timeoutMs > 120000) {
      errors.push("Timeout must be between 5s and 120s");
    }
  }

  if (settings.circuitBreakerThreshold !== undefined) {
    if (settings.circuitBreakerThreshold < 3 || settings.circuitBreakerThreshold > 50) {
      errors.push("Circuit breaker threshold must be between 3 and 50");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
