import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { OAuth2Client } from "google-auth-library";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

// Cache for the OAuth client to avoid re-instantiating constantly
let oauthClient: OAuth2Client | null = null;

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
 * Supports Anthropic (API Key) and Google Gemini (API Key or OAuth).
 */
export async function getAIClient(modelId: string) {
  const settingKeys = [
    "ai_provider",
    "anthropic_api_key",
    "google_auth_mode",
    "google_api_key",
    "google_oauth_tokens",
    "google_client_id",
    "google_client_secret",
    "google_project_id"
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

    // Mode: OAuth (CLI or Web)
    if (authMode === "oauth") {
      const tokensStr = config.get("google_oauth_tokens");
      const clientId = config.get("google_client_id");
      const clientSecret = config.get("google_client_secret");
      const projectId = config.get("google_project_id");

      if (!tokensStr || !clientId || !clientSecret) {
        throw new Error("Google OAuth credentials or tokens are missing");
      }

      const tokens = JSON.parse(tokensStr);

      // Initialize or reuse OAuth client
      if (!oauthClient) {
        oauthClient = new OAuth2Client(
          clientId,
          clientSecret,
          "http://localhost:3000/api/auth/google/callback"
        );
      }

      // Set credentials
      oauthClient.setCredentials(tokens);

      // Force token refresh if needed and get a valid access token
      try {
        const { token } = await oauthClient.getAccessToken();

        if (!token) {
           throw new Error("Failed to retrieve valid access token from Google");
        }

        // Check if tokens were refreshed and save them if so
        // Note: oauthClient.credentials will update automatically
        if (oauthClient.credentials.access_token !== tokens.access_token) {
           await db.update(settings)
             .set({ value: JSON.stringify(oauthClient.credentials), updatedAt: new Date() })
             .where(eq(settings.key, "google_oauth_tokens"));
        }

        // Create provider using the access token
        // The Vercel AI SDK Google provider allows custom headers/fetch.
        // For Gemini API via OAuth (Vertex AI or Generative Language API with User Auth),
        // we generally need to provide the project ID if using the Cloud platform scope.
        // x-goog-user-project is required for quota attribution when using user credentials.

        const google = createGoogleGenerativeAI({
           apiKey: "no-key-needed", // Placeholder
           headers: {
             "Authorization": `Bearer ${token}`,
             // Remove conflicting API key header if SDK adds it
             "x-goog-api-key": undefined as any,
             // Add user project header for quota attribution
             ...(projectId ? { "x-goog-user-project": projectId } : {})
           }
        });

        return google(modelId);

      } catch (error) {
        console.error("Error refreshing Google token:", error);
        throw new Error("Failed to authenticate with Google. Please reconnect in settings.");
      }
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
