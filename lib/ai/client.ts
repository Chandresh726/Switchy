import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createCerebras } from "@ai-sdk/cerebras";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGeminiProvider } from "ai-sdk-provider-gemini-cli";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

async function getSettingsMap(keys: string[]) {
  const results = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, keys));

  const map = new Map<string, string>();
  for (const row of results) {
    if (row.value) map.set(row.key, row.value);
  }
  return map;
}

/**
 * Get a configured AI model instance based on application settings.
 * Supports Anthropic (API Key) and Google Gemini (API Key or CLI).
 */
export async function getAIClient(modelId: string) {
  const settingKeys = [
    "ai_provider",
    "anthropic_api_key",
    "google_auth_mode",
    "google_api_key",
    "openrouter_api_key",
    "cerebras_api_key",
    "openai_api_key",
  ];

  const config = await getSettingsMap(settingKeys);
  const provider = config.get("ai_provider") || "anthropic";
  const normalizedProvider =
    provider === "google"
      ? config.get("google_auth_mode") === "oauth"
        ? "gemini_cli_oauth"
        : "gemini_api_key"
      : provider;

  const requireApiKey = (key: string | undefined, label: string) => {
    if (!key) {
      throw new Error(`${label} API Key is missing in settings`);
    }
    return key;
  };

  // ---------------------------------------------------------
  // Google Gemini Provider (API Key)
  // ---------------------------------------------------------
  if (normalizedProvider === "gemini_api_key") {
    const apiKey = requireApiKey(config.get("google_api_key"), "Gemini");
    const google = createGoogleGenerativeAI({ apiKey });
    return google(modelId);
  }

  // ---------------------------------------------------------
  // Google Gemini Provider (CLI OAuth)
  // ---------------------------------------------------------
  if (normalizedProvider === "gemini_cli_oauth") {
    const google = createGeminiProvider();
    return google(modelId);
  }

  // ---------------------------------------------------------
  // OpenAI Provider
  // ---------------------------------------------------------
  if (normalizedProvider === "openai") {
    const apiKey = requireApiKey(config.get("openai_api_key"), "OpenAI");
    const openai = createOpenAI({ apiKey });
    return openai(modelId);
  }

  // ---------------------------------------------------------
  // OpenRouter Provider
  // ---------------------------------------------------------
  if (normalizedProvider === "openrouter") {
    const apiKey = requireApiKey(config.get("openrouter_api_key"), "OpenRouter");
    const openrouter = createOpenRouter({ apiKey });
    return openrouter.chat(modelId);
  }

  // ---------------------------------------------------------
  // Cerebras Provider
  // ---------------------------------------------------------
  if (normalizedProvider === "cerebras") {
    const apiKey = requireApiKey(config.get("cerebras_api_key"), "Cerebras");
    const cerebras = createCerebras({ apiKey });
    return cerebras(modelId);
  }

  // ---------------------------------------------------------
  // Anthropic Provider (Default)
  // ---------------------------------------------------------
  const apiKey = config.get("anthropic_api_key");
  if (normalizedProvider === "anthropic" && !apiKey) {
    throw new Error("Anthropic API Key is missing in settings");
  }
  // If no key provided, we might be in a dev env or using the proxy (legacy).
  // But for this refactor, we enforce the key if provider is explicitly anthropic.
  // We'll fallback to a dummy key if strictly needed for build, but runtime will fail.

  const anthropic = createAnthropic({
    apiKey: apiKey || "dummy-key-for-build",
  });

  return anthropic(modelId);
}
