import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { aiProviders } from "@/lib/db/schema";
import { decryptApiKey } from "@/lib/encryption";
import { AIError } from "@/lib/ai/shared/errors";

import { providerRegistry } from "./index";
import type { AIProvider } from "./types";

const MODEL_CACHE_TTL_MS = 15 * 60 * 1000;

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

const NON_TEXT_MODEL_PATTERNS = [
  "embedding",
  "embed",
  "moderation",
  "transcrib",
  "whisper",
  "speech",
  "tts",
  "audio",
  "rerank",
  "image",
  "dall-e",
  "vision-preview",
];

interface ProviderRecord {
  id: string;
  provider: AIProvider;
  apiKey?: string;
  updatedAt: Date | null;
}

interface CachedProviderModels {
  providerUpdatedAtMs: number;
  models: ProviderModelDefinition[];
  fetchedAt: string;
  expiresAt: number;
}

interface OpenAIModelsResponse {
  data?: Array<{
    id?: string;
    owned_by?: string;
  }>;
}

interface AnthropicModelsResponse {
  data?: Array<{
    id?: string;
    display_name?: string;
    type?: string;
  }>;
}

interface GeminiModelsResponse {
  models?: Array<{
    name?: string;
    displayName?: string;
    description?: string;
    supportedGenerationMethods?: string[];
  }>;
}

interface OpenRouterModelsResponse {
  data?: Array<{
    id?: string;
    name?: string;
    description?: string;
    architecture?: {
      modality?: string;
      input_modalities?: string[];
      output_modalities?: string[];
    };
  }>;
}

type OpenRouterModelRecord = NonNullable<OpenRouterModelsResponse["data"]>[number];

export interface ProviderModelDefinition {
  modelId: string;
  label: string;
  description: string;
  supportsReasoning: boolean;
}

export interface ProviderModelsResponse {
  providerId: string;
  provider: AIProvider;
  models: ProviderModelDefinition[];
  fetchedAt: string;
  isStale: boolean;
  source: "live" | "cache";
  warning?: string;
}

export interface GetProviderModelsOptions {
  forceRefresh?: boolean;
}

export interface ResolvedProviderModelSelection {
  providerId: string;
  provider: AIProvider;
  modelId: string;
}

const providerModelCache = new Map<string, CachedProviderModels>();

function isLikelyTextModel(modelId: string, label?: string, description?: string): boolean {
  const haystack = `${modelId} ${label ?? ""} ${description ?? ""}`.toLowerCase();
  return !NON_TEXT_MODEL_PATTERNS.some((pattern) => haystack.includes(pattern));
}

function buildModelDefinition(
  providerType: AIProvider,
  modelId: string,
  label?: string,
  description?: string
): ProviderModelDefinition {
  const provider = providerRegistry.get(providerType);

  return {
    modelId,
    label: label?.trim() || modelId,
    description: description?.trim() || "",
    supportsReasoning: provider ? provider.supportsReasoningEffort(modelId) : false,
  };
}

function dedupeModels(models: ProviderModelDefinition[]): ProviderModelDefinition[] {
  const seen = new Set<string>();
  const deduped: ProviderModelDefinition[] = [];

  for (const model of models) {
    if (!model.modelId || seen.has(model.modelId)) {
      continue;
    }
    seen.add(model.modelId);
    deduped.push(model);
  }

  return deduped;
}

async function fetchJson<T>(
  url: string,
  options: RequestInit,
  providerType: AIProvider
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      cache: "no-store",
    });
  } catch (error) {
    throw new AIError({
      type: "network",
      message: `Failed to fetch models from ${providerType}`,
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (!response.ok) {
    const bodyText = await response.text();
    throw new AIError({
      type: "generation_failed",
      message: `Failed to fetch models from ${providerType}: HTTP ${response.status}`,
      context: {
        status: response.status,
        body: bodyText.slice(0, 300),
      },
    });
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new AIError({
      type: "json_parse",
      message: `Invalid model catalog response from ${providerType}`,
      cause: error instanceof Error ? error : undefined,
    });
  }
}

async function getProviderRecord(providerId: string): Promise<ProviderRecord> {
  const result = await db
    .select()
    .from(aiProviders)
    .where(and(eq(aiProviders.id, providerId), eq(aiProviders.isActive, true)))
    .limit(1);

  const provider = result[0];
  if (!provider) {
    throw new AIError({
      type: "provider_not_found",
      message: `Provider "${providerId}" not found`,
    });
  }

  let decryptedApiKey: string | undefined;
  if (provider.apiKey) {
    try {
      decryptedApiKey = decryptApiKey(provider.apiKey);
    } catch (error) {
      throw new AIError({
        type: "decryption_failed",
        message: `Failed to decrypt API key for provider "${provider.provider}"`,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  return {
    id: provider.id,
    provider: provider.provider as AIProvider,
    apiKey: decryptedApiKey,
    updatedAt: provider.updatedAt,
  };
}

async function getFallbackProviderRecord(): Promise<ProviderRecord | null> {
  const providers = await db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.isActive, true))
    .orderBy(aiProviders.isDefault, asc(aiProviders.createdAt));

  if (providers.length === 0) {
    return null;
  }

  const defaultProvider = providers.find((provider) => provider.isDefault);
  const candidate = defaultProvider ?? providers[0];

  let decryptedApiKey: string | undefined;
  if (candidate.apiKey) {
    try {
      decryptedApiKey = decryptApiKey(candidate.apiKey);
    } catch (error) {
      throw new AIError({
        type: "decryption_failed",
        message: `Failed to decrypt API key for provider "${candidate.provider}"`,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  return {
    id: candidate.id,
    provider: candidate.provider as AIProvider,
    apiKey: decryptedApiKey,
    updatedAt: candidate.updatedAt,
  };
}

function ensureApiKey(provider: ProviderRecord): string {
  if (!provider.apiKey) {
    throw new AIError({
      type: "missing_api_key",
      message: `API key is required for provider "${provider.provider}"`,
    });
  }

  return provider.apiKey;
}

async function fetchOpenAICompatibleModels(
  providerType: AIProvider,
  apiKey: string,
  baseUrl: string
): Promise<ProviderModelDefinition[]> {
  const json = await fetchJson<OpenAIModelsResponse>(
    `${baseUrl}/models`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
    providerType
  );

  const rawModels = json.data ?? [];
  const normalized = rawModels
    .map((model) => {
      const modelId = model.id?.trim();
      if (!modelId || !isLikelyTextModel(modelId, model.owned_by)) {
        return null;
      }

      return buildModelDefinition(providerType, modelId, modelId, `${model.owned_by ?? ""} model`.trim());
    })
    .filter((model): model is ProviderModelDefinition => model !== null);

  return dedupeModels(normalized);
}

async function fetchAnthropicModels(
  providerType: AIProvider,
  apiKey: string
): Promise<ProviderModelDefinition[]> {
  const json = await fetchJson<AnthropicModelsResponse>(
    `${ANTHROPIC_BASE_URL}/models`,
    {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    },
    providerType
  );

  const rawModels = json.data ?? [];
  const normalized = rawModels
    .map((model) => {
      const modelId = model.id?.trim();
      if (!modelId || !isLikelyTextModel(modelId, model.display_name, model.type)) {
        return null;
      }

      return buildModelDefinition(
        providerType,
        modelId,
        model.display_name ?? modelId,
        model.type ? `${model.type} model` : ""
      );
    })
    .filter((model): model is ProviderModelDefinition => model !== null);

  return dedupeModels(normalized);
}

async function fetchGeminiModels(
  providerType: AIProvider,
  apiKey: string
): Promise<ProviderModelDefinition[]> {
  const json = await fetchJson<GeminiModelsResponse>(
    `${GEMINI_BASE_URL}/models?key=${encodeURIComponent(apiKey)}`,
    {
      method: "GET",
    },
    providerType
  );

  const rawModels = json.models ?? [];
  const normalized = rawModels
    .map((model) => {
      const modelId = model.name?.replace(/^models\//, "").trim();
      if (!modelId) {
        return null;
      }

      const generationMethods = model.supportedGenerationMethods ?? [];
      const supportsGenerateContent = generationMethods.includes("generateContent") || generationMethods.includes("streamGenerateContent");
      const passesHeuristic = isLikelyTextModel(modelId, model.displayName, model.description);

      if (!supportsGenerateContent || !passesHeuristic) {
        return null;
      }

      return buildModelDefinition(providerType, modelId, model.displayName ?? modelId, model.description ?? "");
    })
    .filter((model): model is ProviderModelDefinition => model !== null);

  return dedupeModels(normalized);
}

function isOpenRouterTextCapable(model: OpenRouterModelRecord): boolean {
  const modality = model.architecture?.modality?.toLowerCase();
  if (modality) {
    return modality.includes("text");
  }

  const inputModalities = model.architecture?.input_modalities?.map((item) => item.toLowerCase()) ?? [];
  const outputModalities = model.architecture?.output_modalities?.map((item) => item.toLowerCase()) ?? [];

  if (inputModalities.length > 0 || outputModalities.length > 0) {
    return inputModalities.includes("text") && outputModalities.includes("text");
  }

  return true;
}

async function fetchOpenRouterModels(
  providerType: AIProvider,
  apiKey: string
): Promise<ProviderModelDefinition[]> {
  const json = await fetchJson<OpenRouterModelsResponse>(
    `${OPENROUTER_BASE_URL}/models`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
    providerType
  );

  const rawModels = json.data ?? [];
  const normalized = rawModels
    .map((model) => {
      const modelId = model.id?.trim();
      if (!modelId || !isOpenRouterTextCapable(model) || !isLikelyTextModel(modelId, model.name, model.description)) {
        return null;
      }

      return buildModelDefinition(
        providerType,
        modelId,
        model.name ?? modelId,
        model.description ?? ""
      );
    })
    .filter((model): model is ProviderModelDefinition => model !== null);

  return dedupeModels(normalized);
}

async function fetchProviderModels(provider: ProviderRecord): Promise<ProviderModelDefinition[]> {
  const providerType = provider.provider;
  const apiKey = ensureApiKey(provider);

  switch (providerType) {
    case "anthropic":
      return fetchAnthropicModels(providerType, apiKey);
    case "gemini_api_key":
      return fetchGeminiModels(providerType, apiKey);
    case "openrouter":
      return fetchOpenRouterModels(providerType, apiKey);
    case "openai":
      return fetchOpenAICompatibleModels(providerType, apiKey, OPENAI_BASE_URL);
    case "groq":
      return fetchOpenAICompatibleModels(providerType, apiKey, GROQ_BASE_URL);
    case "cerebras":
      return fetchOpenAICompatibleModels(providerType, apiKey, CEREBRAS_BASE_URL);
    case "nvidia":
      return fetchOpenAICompatibleModels(providerType, apiKey, NVIDIA_BASE_URL);
    default:
      throw new AIError({
        type: "provider_not_found",
        message: `Provider "${providerType}" is not supported`,
      });
  }
}

function getProviderUpdatedAtMs(provider: ProviderRecord): number {
  return provider.updatedAt?.getTime() ?? 0;
}

function getCacheEntry(provider: ProviderRecord): CachedProviderModels | null {
  const entry = providerModelCache.get(provider.id);
  if (!entry) {
    return null;
  }

  if (entry.providerUpdatedAtMs !== getProviderUpdatedAtMs(provider)) {
    providerModelCache.delete(provider.id);
    return null;
  }

  return entry;
}

function buildResponse(
  provider: ProviderRecord,
  cacheEntry: CachedProviderModels,
  source: "live" | "cache",
  isStale: boolean,
  warning?: string
): ProviderModelsResponse {
  return {
    providerId: provider.id,
    provider: provider.provider,
    models: cacheEntry.models,
    fetchedAt: cacheEntry.fetchedAt,
    isStale,
    source,
    warning,
  };
}

export async function getProviderModels(
  providerId: string,
  options: GetProviderModelsOptions = {}
): Promise<ProviderModelsResponse> {
  const provider = await getProviderRecord(providerId);
  const now = Date.now();
  const cacheEntry = getCacheEntry(provider);

  if (!options.forceRefresh && cacheEntry && cacheEntry.expiresAt > now) {
    return buildResponse(provider, cacheEntry, "cache", false);
  }

  try {
    const models = await fetchProviderModels(provider);
    if (models.length === 0) {
      throw new AIError({
        type: "invalid_model",
        message: `No supported text/chat models found for provider "${provider.provider}"`,
      });
    }

    const freshEntry: CachedProviderModels = {
      providerUpdatedAtMs: getProviderUpdatedAtMs(provider),
      models,
      fetchedAt: new Date().toISOString(),
      expiresAt: now + MODEL_CACHE_TTL_MS,
    };

    providerModelCache.set(provider.id, freshEntry);

    return buildResponse(provider, freshEntry, "live", false);
  } catch (error) {
    if (cacheEntry) {
      const warning = error instanceof Error ? error.message : "Failed to refresh provider models";
      return buildResponse(provider, cacheEntry, "cache", true, warning);
    }

    throw error;
  }
}

export async function resolveProviderModelSelection(options: {
  providerId?: string;
  modelId?: string;
}): Promise<ResolvedProviderModelSelection> {
  let provider: ProviderRecord | null = null;

  if (options.providerId) {
    try {
      provider = await getProviderRecord(options.providerId);
    } catch {
      provider = null;
    }
  }

  if (!provider) {
    provider = await getFallbackProviderRecord();
  }

  if (!provider) {
    throw new AIError({
      type: "provider_not_found",
      message: "No active provider configured",
    });
  }

  const requestedModelId = options.modelId?.trim();

  let providerModels: ProviderModelsResponse | null = null;
  try {
    providerModels = await getProviderModels(provider.id);
  } catch (error) {
    if (!requestedModelId) {
      throw error;
    }
  }

  const availableModels = providerModels?.models ?? [];
  const resolvedModelId = requestedModelId && availableModels.some((model) => model.modelId === requestedModelId)
    ? requestedModelId
    : requestedModelId && availableModels.length === 0
      ? requestedModelId
      : availableModels[0]?.modelId ?? requestedModelId;

  if (!resolvedModelId) {
    throw new AIError({
      type: "invalid_model",
      message: `No valid model available for provider "${provider.provider}"`,
    });
  }

  return {
    providerId: provider.id,
    provider: provider.provider,
    modelId: resolvedModelId,
  };
}

export function clearProviderModelsCache(providerId?: string): void {
  if (providerId) {
    providerModelCache.delete(providerId);
    return;
  }

  providerModelCache.clear();
}

export const PROVIDER_MODELS_CACHE_TTL_MS = MODEL_CACHE_TTL_MS;
