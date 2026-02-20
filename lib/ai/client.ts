import type { LanguageModel } from "ai";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { aiProviders } from "@/lib/db/schema";
import { decryptApiKey } from "@/lib/encryption";

import {
  providerRegistry,
  type AIProvider,
  type ModelConfig,
  type ProviderConfig,
  type ReasoningEffort,
  isAIProvider,
  AIError,
} from "./providers";

export async function getProviderById(providerId: string) {
  const result = await db
    .select()
    .from(aiProviders)
    .where(and(eq(aiProviders.id, providerId), eq(aiProviders.isActive, true)))
    .limit(1);
  return result[0] || null;
}

export async function getDefaultProvider() {
  const result = await db
    .select()
    .from(aiProviders)
    .where(and(eq(aiProviders.isActive, true), eq(aiProviders.isDefault, true)))
    .limit(1);
  return result[0] || null;
}

function getApiKeyFromDb(provider: typeof aiProviders.$inferSelect): string | undefined {
  if (!provider.apiKey) {
    return undefined;
  }
  try {
    return decryptApiKey(provider.apiKey);
  } catch (error) {
    console.error(
      `Failed to decrypt API key for provider "${provider.provider}" (id: ${provider.id}):`,
      error
    );
    throw new AIError({
      type: "decryption_failed",
      message: `Failed to decrypt API key for provider "${provider.provider}": ${error instanceof Error ? error.message : "Unknown error"}`,
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export interface GetAIClientOptions {
  modelId: string;
  reasoningEffort?: ReasoningEffort;
  providerId?: string;
}

function getProviderType(providerValue: string): AIProvider {
  if (!isAIProvider(providerValue)) {
    throw new AIError({
      type: "provider_not_found",
      message: `Provider "${providerValue}" is not registered`,
    });
  }

  return providerValue;
}

async function resolveProviderType(providerId?: string): Promise<AIProvider | null> {
  if (providerId) {
    const dbProvider = await getProviderById(providerId);
    if (!dbProvider) {
      return null;
    }
    return getProviderType(dbProvider.provider);
  }

  const defaultProvider = await getDefaultProvider();
  if (!defaultProvider) {
    return null;
  }

  return getProviderType(defaultProvider.provider);
}

export async function getAIClientV2(
  options: GetAIClientOptions
): Promise<LanguageModel> {
  let providerType: AIProvider | null = null;
  let apiKey: string | undefined;

  if (options.providerId) {
    const dbProvider = await getProviderById(options.providerId);
    if (!dbProvider) {
      throw new AIError({ type: "provider_not_found", message: `Provider "${options.providerId}" not found` });
    }
    providerType = getProviderType(dbProvider.provider);
    apiKey = getApiKeyFromDb(dbProvider);
  } else {
    const defaultProvider = await getDefaultProvider();
    if (!defaultProvider) {
      throw new AIError({ type: "provider_not_found", message: "No default provider configured" });
    }
    providerType = getProviderType(defaultProvider.provider);
    apiKey = getApiKeyFromDb(defaultProvider);
  }

  if (!providerType) {
    throw new AIError({ type: "provider_not_found", message: "No active provider configured" });
  }

  const provider = providerRegistry.get(providerType);

  if (!provider) {
    throw new AIError({ type: "provider_not_found", message: `Provider "${providerType}" is not registered` });
  }

  if (!apiKey && provider.requiresApiKey) {
    throw new AIError({ type: "missing_api_key", message: `API key is required for provider "${providerType}"` });
  }

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

export async function getAIGenerationOptions(
  modelId: string,
  reasoningEffort?: ReasoningEffort,
  providerId?: string
): Promise<Record<string, unknown> | undefined> {
  const providerType = await resolveProviderType(providerId);
  if (!providerType) {
    return undefined;
  }

  const provider = providerRegistry.get(providerType);
  if (!provider) {
    return undefined;
  }

  return provider.getGenerationOptions({
    modelId,
    reasoningEffort,
  });
}

export type { AIProvider, ModelConfig } from "./providers";
