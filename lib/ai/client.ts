import { db } from "@/lib/db";
import { aiProviders } from "@/lib/db/schema";
import type { LanguageModel } from "ai";
import {
  providerRegistry,
  type AIProvider,
  type ModelConfig,
  type ProviderConfig,
  AIError,
} from "./providers";
import { decryptApiKey } from "@/lib/encryption";
import { eq, and, desc } from "drizzle-orm";

export async function getAllActiveProviders() {
  return db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.isActive, true))
    .orderBy(desc(aiProviders.isDefault), desc(aiProviders.createdAt));
}

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
  reasoningEffort?: "low" | "medium" | "high";
  providerId?: string;
}

export async function getAIClientV2(
  options: GetAIClientOptions
): Promise<LanguageModel> {
  let providerType: AIProvider;
  let apiKey: string | undefined;

  if (options.providerId) {
    const dbProvider = await getProviderById(options.providerId);
    if (!dbProvider) {
      throw new AIError({ type: "provider_not_found", message: `Provider "${options.providerId}" not found` });
    }
    if (!providerRegistry.has(dbProvider.provider as AIProvider)) {
      throw new AIError({ type: "provider_not_found", message: `Provider "${dbProvider.provider}" is not registered` });
    }
    providerType = dbProvider.provider as AIProvider;
    apiKey = getApiKeyFromDb(dbProvider);
  } else {
    const defaultProvider = await getDefaultProvider();
    if (!defaultProvider) {
      throw new AIError({ type: "provider_not_found", message: "No default provider configured" });
    }
    if (!providerRegistry.has(defaultProvider.provider as AIProvider)) {
      throw new AIError({ type: "provider_not_found", message: `Provider "${defaultProvider.provider}" is not registered` });
    }
    providerType = defaultProvider.provider as AIProvider;
    apiKey = getApiKeyFromDb(defaultProvider);
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
  reasoningEffort?: string,
  providerId?: string
): Promise<Record<string, unknown> | undefined> {
  let providerType: AIProvider;
  
  if (providerId) {
    const dbProvider = await getProviderById(providerId);
    if (!dbProvider) {
      return undefined;
    }
    providerType = dbProvider.provider as AIProvider;
  } else {
    const defaultProvider = await getDefaultProvider();
    if (!defaultProvider) {
      return undefined;
    }
    providerType = defaultProvider.provider as AIProvider;
  }

  const provider = providerRegistry.get(providerType);
  if (!provider) {
    return undefined;
  }

  return provider.getGenerationOptions({
    modelId,
    reasoningEffort: reasoningEffort as "low" | "medium" | "high",
  });
}

export async function modelSupportsReasoningEffort(
  modelId: string
): Promise<boolean> {
  const defaultProvider = await getDefaultProvider();
  if (!defaultProvider) {
    return false;
  }
  
  const providerType = defaultProvider.provider as AIProvider;
  const provider = providerRegistry.get(providerType);

  if (!provider) {
    return false;
  }

  return provider.supportsReasoningEffort(modelId);
}

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

export type { AIProvider, ModelConfig } from "./providers";
