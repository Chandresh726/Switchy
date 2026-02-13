import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import type { LanguageModel } from "ai";
import {
  providerRegistry,
  type AIProvider,
  type AIClientSettings,
  type ModelConfig,
  type ProviderConfig,
  AIError,
} from "./providers";

const AI_SETTING_KEYS = [
  "ai_provider",
  "anthropic_api_key",
  "google_auth_mode",
  "google_api_key",
  "openrouter_api_key",
  "cerebras_api_key",
  "openai_api_key",
  "modal_api_key",
] as const;

class SettingsCache {
  private cache: Map<string, string> | null = null;
  private timestamp: number = 0;
  private readonly ttlMs: number;

  constructor(ttlMs: number = 60000) {
    this.ttlMs = ttlMs;
  }

  async get(keys: readonly string[]): Promise<Map<string, string>> {
    const now = Date.now();
    if (this.cache && now - this.timestamp < this.ttlMs) {
      return this.cache;
    }
    const results = await db.select().from(settings).where(inArray(settings.key, keys));
    this.cache = new Map<string, string>();
    for (const row of results) {
      if (row.value) this.cache.set(row.key, row.value);
    }
    this.timestamp = now;
    return this.cache;
  }

  invalidate(): void {
    this.cache = null;
    this.timestamp = 0;
  }
}

const settingsCache = new SettingsCache(30000);

export function invalidateAISettingsCache(): void {
  settingsCache.invalidate();
}

/**
 * Parse AI client settings from database
 */
async function parseAIClientSettings(): Promise<AIClientSettings> {
  const config = await settingsCache.get(AI_SETTING_KEYS);

  const provider = (config.get("ai_provider") || "anthropic") as AIProvider;

  // Normalize provider based on Google auth mode
  let normalizedProvider: AIProvider = provider;
  if (provider === "google") {
    normalizedProvider =
      config.get("google_auth_mode") === "oauth"
        ? "gemini_cli_oauth"
        : "gemini_api_key";
  }

  return {
    aiProvider: normalizedProvider,
    anthropicApiKey: config.get("anthropic_api_key"),
    googleAuthMode:
      (config.get("google_auth_mode") as "oauth" | "api_key") || "api_key",
    googleApiKey: config.get("google_api_key"),
    openrouterApiKey: config.get("openrouter_api_key"),
    cerebrasApiKey: config.get("cerebras_api_key"),
    openaiApiKey: config.get("openai_api_key"),
    modalApiKey: config.get("modal_api_key"),
  };
}

/**
 * Get API key for a specific provider
 */
function getApiKeyForProvider(
  settings: AIClientSettings,
  provider: AIProvider
): string | undefined {
  switch (provider) {
    case "anthropic":
      return settings.anthropicApiKey;
    case "gemini_api_key":
      return settings.googleApiKey;
    case "openai":
      return settings.openaiApiKey;
    case "openrouter":
      return settings.openrouterApiKey;
    case "cerebras":
      return settings.cerebrasApiKey;
    case "modal":
      return settings.modalApiKey;
    case "gemini_cli_oauth":
      return undefined; // No API key needed for OAuth
    default:
      return undefined;
  }
}

/**
 * Get a configured AI client instance
 * Legacy function - delegates to getAIClientV2
 */
export async function getAIClient(
  modelId: string,
  reasoningEffort?: string
): Promise<LanguageModel> {
  return getAIClientV2({
    modelId,
    reasoningEffort: reasoningEffort as "low" | "medium" | "high" | undefined,
  });
}

/**
 * Get a configured AI client instance with full configuration options
 * This is the new preferred API
 */
export interface GetAIClientOptions {
  modelId: string;
  reasoningEffort?: "low" | "medium" | "high";
}

export async function getAIClientV2(
  options: GetAIClientOptions
): Promise<LanguageModel> {
  const clientSettings = await parseAIClientSettings();
  const provider = providerRegistry.get(clientSettings.aiProvider);

  if (!provider) {
    throw new AIError(
      "provider_not_found",
      `Provider "${clientSettings.aiProvider}" is not registered`
    );
  }

  const apiKey = getApiKeyForProvider(clientSettings, provider.id);

  const modelConfig: ModelConfig = {
    modelId: options.modelId,
    reasoningEffort: options.reasoningEffort,
  };

  const providerConfig: ProviderConfig = {
    apiKey,
  };

  return provider.createModel({
    config: modelConfig,
    providerConfig,
  });
}

/**
 * Get generation options for the current AI provider
 * These options should be spread into generateText/generateObject calls
 */
export async function getAIGenerationOptions(
  modelId: string,
  reasoningEffort?: string
): Promise<Record<string, unknown> | undefined> {
  const clientSettings = await parseAIClientSettings();
  const provider = providerRegistry.get(clientSettings.aiProvider);

  if (!provider) {
    return undefined;
  }

  return provider.getGenerationOptions({
    modelId,
    reasoningEffort: reasoningEffort as "low" | "medium" | "high",
  });
}

/**
 * Check if the current model supports reasoning effort
 */
export async function modelSupportsReasoningEffort(
  modelId: string
): Promise<boolean> {
  const clientSettings = await parseAIClientSettings();
  const provider = providerRegistry.get(clientSettings.aiProvider);

  if (!provider) {
    return false;
  }

  return provider.supportsReasoningEffort(modelId);
}

/**
 * Legacy synchronous check for reasoning effort support
 * Note: This doesn't account for provider-specific support
 */
export function modelSupportsReasoningEffortSync(modelId: string): boolean {
  const reasoningModels = [
    "gemini-3-",
    "gpt-5.2",
    "gpt-5-mini",
    "gpt-oss-120b",
    "qwen-3-32b",
    "zai-glm-4.7",
  ];
  return reasoningModels.some((model) => modelId.includes(model));
}

/**
 * Get the currently configured AI provider ID
 */
export async function getCurrentProvider(): Promise<AIProvider | undefined> {
  const settings = await parseAIClientSettings();
  return settings.aiProvider;
}

// Re-export provider types for convenience
export type { AIProvider, AIClientSettings, ModelConfig } from "./providers";
