import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import { BaseProvider } from "./base-provider";
import { createCustomProviderFetch, customProviderFetch } from "./custom-fetch";
import { AIError, type AIProvider, type ModelConfig, type ProviderConfig } from "./types";

function findHeaderEntry(
  headers: Record<string, string> | undefined,
  name: string
): [string, string] | undefined {
  return Object.entries(headers ?? {}).find(
    ([headerName]) => headerName.toLowerCase() === name.toLowerCase()
  );
}

function canonicalizeAuthenticationHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const normalized = { ...headers };
  for (const canonicalName of ["Authorization", "x-api-key", "anthropic-version"] as const) {
    const match = findHeaderEntry(normalized, canonicalName);
    if (!match) continue;
    for (const name of Object.keys(normalized)) {
      if (name.toLowerCase() === canonicalName.toLowerCase()) delete normalized[name];
    }
    normalized[canonicalName] = match[1];
  }
  return normalized;
}

export class CustomProvider extends BaseProvider {
  readonly id: AIProvider = "custom";
  readonly name = "Custom";
  readonly requiresApiKey = false;

  protected override validateConfig(config: ProviderConfig): void {
    super.validateConfig(config);
    if (!config.baseUrl || !config.apiFormat) {
      throw new AIError({
        type: "validation",
        message: "Custom provider URL and API format are required",
        retryable: false,
      });
    }
  }

  protected createLanguageModel(
    config: ModelConfig,
    providerConfig: ProviderConfig
  ): LanguageModel {
    const baseURL = providerConfig.baseUrl!;
    const headers = canonicalizeAuthenticationHeaders(providerConfig.headers);
    const customAuthorization = findHeaderEntry(headers, "authorization")?.[1];

    switch (providerConfig.apiFormat) {
      case "openai_chat_completions": {
        const provider = createOpenAICompatible({
          name: "custom",
          baseURL,
          apiKey: providerConfig.apiKey,
          headers,
          fetch: customProviderFetch,
        });
        return provider.chatModel(config.modelId);
      }
      case "openai_responses": {
        const stripPlaceholder = !providerConfig.apiKey && !customAuthorization;
        const provider = createOpenAI({
          name: "custom",
          baseURL,
          apiKey: providerConfig.apiKey ?? "switchy-no-auth",
          headers,
          fetch: stripPlaceholder
            ? createCustomProviderFetch({ stripHeaders: ["authorization"] })
            : customProviderFetch,
        });
        return provider.responses(config.modelId);
      }
      case "anthropic_messages": {
        const configuredApiKey = findHeaderEntry(headers, "x-api-key")?.[1] ?? providerConfig.apiKey;
        const authorization = customAuthorization;
        const authToken = !configuredApiKey && authorization?.startsWith("Bearer ")
          ? authorization.slice("Bearer ".length)
          : undefined;
        const stripPlaceholderKey = !configuredApiKey && !authToken;
        const provider = createAnthropic({
          name: "custom.messages",
          baseURL,
          ...(authToken
            ? { authToken }
            : { apiKey: configuredApiKey ?? "switchy-no-auth" }),
          headers,
          ...(stripPlaceholderKey
            ? {
                fetch: createCustomProviderFetch({ stripHeaders: ["x-api-key"] }),
              }
            : { fetch: customProviderFetch }),
        });
        return provider.messages(config.modelId);
      }
      default:
        throw new AIError({
          type: "validation",
          message: "Unsupported custom provider API format",
          retryable: false,
        });
    }
  }
}

export const customProvider = new CustomProvider();
