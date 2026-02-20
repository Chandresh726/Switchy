import { cache } from "react";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { getProviderById } from "@/lib/ai/client";
import { resolveProviderModelSelection } from "@/lib/ai/providers/model-catalog";
import {
  type MatcherConfig,
  DEFAULT_MATCHER_CONFIG,
  PROVIDER_DEFAULTS,
} from "./types";

const MATCHER_SETTING_KEYS = [
  "matcher_model",
  "matcher_provider_id",
  "matcher_reasoning_effort",
  "matcher_bulk_enabled",
  "matcher_batch_size",
  "matcher_max_retries",
  "matcher_concurrency_limit",
  "matcher_serialize_operations",
  "matcher_inter_request_delay_ms",
  "matcher_timeout_ms",
  "matcher_backoff_base_delay",
  "matcher_backoff_max_delay",
  "matcher_circuit_breaker_threshold",
  "matcher_circuit_breaker_reset_timeout",
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

export const getMatcherConfig = cache(async (): Promise<MatcherConfig & { providerId?: string }> => {
  const dbSettings = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, MATCHER_SETTING_KEYS));

  const settingsMap = new Map(dbSettings.map((s) => [s.key, s.value]));

  const storedProviderId = settingsMap.get("matcher_provider_id") || undefined;
  const storedModelId = settingsMap.get("matcher_model") || undefined;

  let resolvedProviderId = storedProviderId;
  let resolvedModelId = storedModelId ?? DEFAULT_MATCHER_CONFIG.model;
  let currentProvider = "";

  try {
    const resolvedSelection = await resolveProviderModelSelection({
      providerId: storedProviderId,
      modelId: storedModelId,
    });

    resolvedProviderId = resolvedSelection.providerId;
    resolvedModelId = resolvedSelection.modelId;
    currentProvider = resolvedSelection.provider;
  } catch {
    if (storedProviderId) {
      const provider = await getProviderById(storedProviderId);
      if (provider) {
        currentProvider = provider.provider;
      }
    }
  }
  
  const providerDefaults = PROVIDER_DEFAULTS[currentProvider] || {};

  return {
    providerId: resolvedProviderId,
    model: resolvedModelId,
    reasoningEffort:
      settingsMap.get("matcher_reasoning_effort") ||
      DEFAULT_MATCHER_CONFIG.reasoningEffort,
    bulkEnabled: parseBoolean(
      settingsMap.get("matcher_bulk_enabled"),
      providerDefaults.bulkEnabled ?? DEFAULT_MATCHER_CONFIG.bulkEnabled
    ),
    batchSize: parseNumber(
      settingsMap.get("matcher_batch_size"),
      providerDefaults.batchSize ?? DEFAULT_MATCHER_CONFIG.batchSize
    ),
    maxRetries: parseNumber(
      settingsMap.get("matcher_max_retries"),
      providerDefaults.maxRetries ?? DEFAULT_MATCHER_CONFIG.maxRetries
    ),
    concurrencyLimit: parseNumber(
      settingsMap.get("matcher_concurrency_limit"),
      providerDefaults.concurrencyLimit ?? DEFAULT_MATCHER_CONFIG.concurrencyLimit
    ),
    serializeOperations: parseBoolean(
      settingsMap.get("matcher_serialize_operations"),
      providerDefaults.serializeOperations ?? DEFAULT_MATCHER_CONFIG.serializeOperations
    ),
    interRequestDelayMs: parseNumber(
      settingsMap.get("matcher_inter_request_delay_ms"),
      providerDefaults.interRequestDelayMs ?? DEFAULT_MATCHER_CONFIG.interRequestDelayMs
    ),
    timeoutMs: parseNumber(
      settingsMap.get("matcher_timeout_ms"),
      providerDefaults.timeoutMs ?? DEFAULT_MATCHER_CONFIG.timeoutMs
    ),
    backoffBaseDelay: parseNumber(
      settingsMap.get("matcher_backoff_base_delay"),
      providerDefaults.backoffBaseDelay ?? DEFAULT_MATCHER_CONFIG.backoffBaseDelay
    ),
    backoffMaxDelay: parseNumber(
      settingsMap.get("matcher_backoff_max_delay"),
      providerDefaults.backoffMaxDelay ?? DEFAULT_MATCHER_CONFIG.backoffMaxDelay
    ),
    circuitBreakerThreshold: parseNumber(
      settingsMap.get("matcher_circuit_breaker_threshold"),
      providerDefaults.circuitBreakerThreshold ?? DEFAULT_MATCHER_CONFIG.circuitBreakerThreshold
    ),
    circuitBreakerResetTimeout: parseNumber(
      settingsMap.get("matcher_circuit_breaker_reset_timeout"),
      providerDefaults.circuitBreakerResetTimeout ?? DEFAULT_MATCHER_CONFIG.circuitBreakerResetTimeout
    ),
    autoMatchAfterScrape: parseBoolean(
      settingsMap.get("matcher_auto_match_after_scrape"),
      providerDefaults.autoMatchAfterScrape ?? DEFAULT_MATCHER_CONFIG.autoMatchAfterScrape
    ),
  };
});

export function getDefaultConfig(): MatcherConfig {
  return { ...DEFAULT_MATCHER_CONFIG };
}

export function getProviderDefaults(provider: string): Partial<MatcherConfig> {
  return PROVIDER_DEFAULTS[provider] || {};
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
    if (config.maxRetries < 1 || config.maxRetries > 5) {
      errors.push("Max retries must be between 1 and 5");
    }
  }

  if (config.concurrencyLimit !== undefined) {
    if (config.concurrencyLimit < 1 || config.concurrencyLimit > 10) {
      errors.push("Concurrency limit must be between 1 and 10");
    }
  }

  if (config.interRequestDelayMs !== undefined) {
    if (config.interRequestDelayMs < 0 || config.interRequestDelayMs > 10000) {
      errors.push("Inter-request delay must be between 0ms and 10s");
    }
  }

  if (config.timeoutMs !== undefined) {
    if (config.timeoutMs < 5000 || config.timeoutMs > 120000) {
      errors.push("Timeout must be between 5s and 120s");
    }
  }

  if (config.circuitBreakerThreshold !== undefined) {
    if (config.circuitBreakerThreshold < 3 || config.circuitBreakerThreshold > 50) {
      errors.push("Circuit breaker threshold must be between 3 and 50");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
