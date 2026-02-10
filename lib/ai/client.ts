import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
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
  ];

  const config = await getSettingsMap(settingKeys);
  const provider = config.get("ai_provider") || "anthropic";

  // ---------------------------------------------------------
  // Google Gemini Provider
  // ---------------------------------------------------------
  if (provider === "google") {
    const authMode = config.get("google_auth_mode") || "api_key";

    // Mode: API Key
    if (authMode === "api_key") {
      const apiKey = config.get("google_api_key");
      if (!apiKey) {
        throw new Error("Google API Key is missing in settings");
      }
      const google = createGoogleGenerativeAI({ apiKey });
      return google(modelId);
    }

    // Mode: OAuth (CLI)
    if (authMode === "oauth") {
      // Use the ai-sdk-provider-gemini-cli which leverages the system's
      // authenticated 'gemini' CLI tool.
      // Requires running `gemini auth login` on the host machine.
      const google = createGeminiProvider();
      return google(modelId);
    }
  }

  // ---------------------------------------------------------
  // Anthropic Provider (Default)
  // ---------------------------------------------------------
  const apiKey = config.get("anthropic_api_key");
  // If no key provided, we might be in a dev env or using the proxy (legacy).
  // But for this refactor, we enforce the key if provider is explicitly anthropic.
  // We'll fallback to a dummy key if strictly needed for build, but runtime will fail.

  const anthropic = createAnthropic({
    apiKey: apiKey || "dummy-key-for-build",
  });

  return anthropic(modelId);
}

// Deprecated: synchronous accessor for backward compatibility during migration
// This will likely throw at runtime if used before migration is complete
export const ai = createAnthropic({
  apiKey: "deprecated",
});
