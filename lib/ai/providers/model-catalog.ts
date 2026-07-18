import "server-only";

import { and, asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { z } from "zod";

import { db } from "@/lib/db";
import { aiProviders, settings } from "@/lib/db/schema";
import type * as databaseSchema from "@/lib/db/schema";
import { decryptApiKey } from "@/lib/encryption";
import { AIError } from "@/lib/ai/shared/errors";
import { getLocalCLIModels } from "@/lib/ai/local-cli/service";

import {
  buildCustomRequestHeaders,
  resolveStoredCustomProvider,
  type CustomProviderConnection,
} from "./custom-config";
import {
  cancelCustomProviderResponse,
  customProviderFetch,
} from "./custom-fetch";

import {
  isAIProvider,
  isLocalCLIProvider,
  isReasoningEffort,
  type AIProvider,
} from "./types";
import {
  createEffortReasoningControl,
  withReasoningControl,
  type ProviderReasoningControl,
} from "./reasoning-controls";

export type { ProviderReasoningControl } from "./reasoning-controls";

const MODEL_CACHE_TTL_MS = 15 * 60 * 1000;
const MODEL_CATALOG_SCHEMA_VERSION = 2;
const CUSTOM_MODEL_DISCOVERY_TIMEOUT_MS = 10_000;
const CUSTOM_MODEL_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

const GPT_5_6_REASONING_CONTROL = createEffortReasoningControl(
  ["none", "low", "medium", "high", "xhigh", "max"].map((value) => ({ value })),
  "medium"
);

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

export interface ResolvedProviderCatalogRecord {
  id: string;
  provider: AIProvider;
  apiKey?: string;
  updatedAt: Date | null;
  customConnection?: CustomProviderConnection;
}

type ProviderRecord = ResolvedProviderCatalogRecord;

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

const customModelsResponseSchema = z.object({
  data: z.array(z.object({
    id: z.string().optional(),
    display_name: z.string().optional(),
    owned_by: z.string().optional(),
    type: z.string().optional(),
  })),
});

interface GeminiModelsResponse {
  models?: Array<{
    name?: string;
    displayName?: string;
    description?: string;
    supportedGenerationMethods?: string[];
    thinking?: boolean;
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
    supported_parameters?: string[];
    reasoning?: {
      supported_efforts?: string[] | null;
      default_effort?: string | null;
      default_enabled?: boolean;
      mandatory?: boolean;
    };
  }>;
}

type OpenRouterModelRecord = NonNullable<OpenRouterModelsResponse["data"]>[number];

export interface ProviderModelDefinition {
  modelId: string;
  label: string;
  description: string;
  supportsReasoning: boolean;
  reasoningControl: ProviderReasoningControl;
  group?: string;
  upstreamProvider?: string;
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string;
  isDefault?: boolean;
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
  allowStaleOnError?: boolean;
}

export interface ResolvedProviderModelSelection {
  providerId: string;
  provider: AIProvider;
  modelId: string;
}

const providerModelCache = new Map<string, CachedProviderModels>();
const boundedDisplayText = (maxLength: number) =>
  z.string().transform((value) => value.slice(0, maxLength));
const ReasoningOptionSchema = z.object({
  value: z.string().refine(isReasoningEffort, "Invalid provider reasoning value"),
  label: boundedDisplayText(120).optional(),
  description: boundedDisplayText(500).optional(),
}).strict();
const ReasoningControlSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("effort"),
    options: z.array(ReasoningOptionSchema).min(1).max(100),
    defaultValue: z.string().refine(isReasoningEffort).optional(),
  }).strict(),
  z.object({ kind: z.literal("provider_default") }).strict(),
]).superRefine((control, context) => {
  if (control.kind === "effort" && control.defaultValue &&
      !control.options.some(({ value }) => value === control.defaultValue)) {
    context.addIssue({
      code: "custom",
      message: "The advertised reasoning default must be one of the options",
      path: ["defaultValue"],
    });
  }
});
const ProviderModelDefinitionSchema = z.object({
  modelId: z.string().min(1).max(240),
  label: boundedDisplayText(240),
  description: boundedDisplayText(2_000),
  supportsReasoning: z.boolean(),
  reasoningControl: ReasoningControlSchema,
  group: boundedDisplayText(240).optional(),
  upstreamProvider: boundedDisplayText(120).optional(),
  supportedReasoningEfforts: z.array(
    z.string().refine(isReasoningEffort)
  ).max(100).optional(),
  defaultReasoningEffort: z.string().refine(isReasoningEffort).optional(),
  isDefault: z.boolean().optional(),
}).strict().superRefine((model, context) => {
  const expectedEfforts = model.reasoningControl.kind === "effort"
    ? model.reasoningControl.options.map(({ value }) => value)
    : [];
  if ((model.supportedReasoningEfforts ?? []).join("\0") !== expectedEfforts.join("\0")) {
    context.addIssue({
      code: "custom",
      message: "Compatibility efforts must match the provider-native control",
      path: ["supportedReasoningEfforts"],
    });
  }
  const expectedDefault = model.reasoningControl.kind === "effort"
    ? model.reasoningControl.defaultValue
    : undefined;
  if (model.defaultReasoningEffort !== expectedDefault) {
    context.addIssue({
      code: "custom",
      message: "Compatibility default must match the provider-native control",
      path: ["defaultReasoningEffort"],
    });
  }
});
const StoredProviderCatalogSchema = z.object({
  schemaVersion: z.literal(MODEL_CATALOG_SCHEMA_VERSION),
  providerUpdatedAtMs: z.number().int().nonnegative(),
  fetchedAt: z.string().datetime(),
  models: z.array(ProviderModelDefinitionSchema).max(1_000),
}).strict();

function catalogSettingKey(providerId: string): string {
  return `provider_model_catalog:${providerId}`;
}

function isLikelyTextModel(modelId: string, label?: string, description?: string): boolean {
  const haystack = `${modelId} ${label ?? ""} ${description ?? ""}`.toLowerCase();
  return !NON_TEXT_MODEL_PATTERNS.some((pattern) => haystack.includes(pattern));
}

function buildModelDefinition(
  modelId: string,
  label?: string,
  description?: string,
  supportsReasoning = false
): ProviderModelDefinition {
  return withReasoningControl({
    modelId,
    label: label?.trim() || modelId,
    description: description?.trim() || "",
  }, { kind: "provider_default" }, supportsReasoning);
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

function getCustomModelReasoningControl(
  connection: CustomProviderConnection,
  modelId: string
): ProviderReasoningControl {
  if (connection.reasoningEfforts.length > 0) {
    return createEffortReasoningControl(
      connection.reasoningEfforts.map((value) => ({ value })),
      connection.reasoningEfforts.includes("medium") ? "medium" : undefined
    );
  }

  if (
    connection.apiFormat !== "anthropic_messages" &&
    /^gpt-5\.6(?:-(?:luna|sol|terra))?$/i.test(modelId)
  ) {
    return GPT_5_6_REASONING_CONTROL;
  }

  return { kind: "provider_default" };
}

async function fetchJson<T>(
  url: string,
  options: RequestInit,
  providerType: AIProvider
): Promise<T> {
  let response: Response;
  try {
    const fetcher = providerType === "custom" ? customProviderFetch : fetch;
    response = await fetcher(url, {
      ...options,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof AIError) throw error;
    const timedOut = providerType === "custom" &&
      error instanceof Error &&
      ["AbortError", "TimeoutError"].includes(error.name);
    throw new AIError({
      type: timedOut ? "timeout" : "network",
      message: timedOut
        ? "Custom provider model discovery timed out"
        : `Failed to fetch models from ${providerType}`,
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (!response.ok) {
    const bodyText = providerType === "custom" ? "" : await response.text();
    if (providerType === "custom") await cancelCustomProviderResponse(response);
    throw new AIError({
      type: "generation_failed",
      message: `Failed to fetch models from ${providerType}: HTTP ${response.status}`,
      context: {
        status: response.status,
        ...(providerType === "custom" ? {} : { body: bodyText.slice(0, 300) }),
      },
    });
  }

  try {
    if (providerType === "custom") {
      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (contentLength > CUSTOM_MODEL_RESPONSE_MAX_BYTES) {
        await cancelCustomProviderResponse(response);
        throw new Error("Custom provider model response is too large");
      }
      if (!response.body) {
        const body = await response.text();
        if (new TextEncoder().encode(body).byteLength > CUSTOM_MODEL_RESPONSE_MAX_BYTES) {
          throw new Error("Custom provider model response is too large");
        }
        return JSON.parse(body) as T;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let totalBytes = 0;
      let body = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > CUSTOM_MODEL_RESPONSE_MAX_BYTES) {
          await reader.cancel();
          throw new Error("Custom provider model response is too large");
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
      return JSON.parse(body) as T;
    }
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

  if (!isAIProvider(provider.provider)) {
    throw new AIError({
      type: "provider_not_found",
      message: `Provider "${provider.provider}" is not supported`,
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
    provider: provider.provider,
    apiKey: decryptedApiKey,
    updatedAt: provider.updatedAt,
    customConnection: provider.provider === "custom"
      ? resolveStoredCustomProvider(provider, decryptedApiKey)
      : undefined,
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

  const apiProviders = providers.filter(
    (provider) => !isLocalCLIProvider(provider.provider)
  );
  const defaultProvider = apiProviders.find((provider) => provider.isDefault);
  const candidate = defaultProvider ?? apiProviders[0];

  if (!candidate) return null;

  if (!isAIProvider(candidate.provider)) {
    throw new AIError({
      type: "provider_not_found",
      message: `Provider "${candidate.provider}" is not supported`,
    });
  }

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
    provider: candidate.provider,
    apiKey: decryptedApiKey,
    updatedAt: candidate.updatedAt,
    customConnection: candidate.provider === "custom"
      ? resolveStoredCustomProvider(candidate, decryptedApiKey)
      : undefined,
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

      return buildModelDefinition(modelId, modelId, `${model.owned_by ?? ""} model`.trim());
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
        modelId,
        model.display_name ?? modelId,
        model.type ? `${model.type} model` : ""
      );
    })
    .filter((model): model is ProviderModelDefinition => model !== null);

  return dedupeModels(normalized);
}

export async function discoverCustomProviderModels(
  connection: CustomProviderConnection
): Promise<ProviderModelDefinition[]> {
  const payload = await fetchJson<unknown>(
    `${connection.baseUrl}/models`,
    {
      method: "GET",
      headers: buildCustomRequestHeaders(connection),
      signal: AbortSignal.timeout(CUSTOM_MODEL_DISCOVERY_TIMEOUT_MS),
    },
    "custom"
  );
  const parsed = customModelsResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AIError({
      type: "validation",
      message: "Invalid custom provider model catalog",
      retryable: false,
      cause: parsed.error,
    });
  }

  const rawModels = parsed.data.data;
  if (rawModels.length > 1_000) {
    throw new AIError({
      type: "validation",
      message: "The custom provider returned more than 1,000 models",
      retryable: false,
    });
  }
  const buildCustomModelDefinition = (
    modelId: string,
    label: string,
    description: string
  ): ProviderModelDefinition => withReasoningControl({
    modelId,
    label,
    description,
  }, getCustomModelReasoningControl(connection, modelId));
  const discovered = rawModels
    .map((model) => {
      const modelId = model.id?.trim();
      if (!modelId || !isLikelyTextModel(
        modelId,
        model.display_name,
        model.owned_by ?? model.type
      )) {
        return null;
      }
      const label = connection.apiFormat === "anthropic_messages"
        ? model.display_name
        : undefined;
      const description = model.owned_by ?? model.type ?? "";
      return buildCustomModelDefinition(modelId, label ?? modelId, description);
    })
    .filter((model): model is ProviderModelDefinition => model !== null);
  const manual = connection.manualModelIds.map((modelId) =>
    buildCustomModelDefinition(modelId, modelId, "Manually configured model")
  );
  const models = dedupeModels([...discovered, ...manual]);
  if (models.length > 1_000) {
    throw new AIError({
      type: "validation",
      message: "The custom provider catalog cannot contain more than 1,000 models",
      retryable: false,
    });
  }
  if (models.length === 0) {
    throw new AIError({
      type: "invalid_model",
      message: "The custom provider did not return any text/chat models",
      retryable: false,
    });
  }
  return models;
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

      return buildModelDefinition(
        modelId,
        model.displayName ?? modelId,
        model.description ?? "",
        model.thinking === true
      );
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

      const reasoningControl = createEffortReasoningControl(
        (model.reasoning?.supported_efforts ?? []).map((value) => ({ value })),
        model.reasoning?.default_effort ?? undefined
      );
      const supportsReasoning = reasoningControl.kind === "effort" ||
        model.supported_parameters?.includes("reasoning") === true;

      return withReasoningControl({
        modelId,
        label: model.name?.trim() || modelId,
        description: model.description?.trim() || "",
      }, reasoningControl, supportsReasoning);
    })
    .filter((model): model is ProviderModelDefinition => model !== null);

  return dedupeModels(normalized);
}

async function fetchProviderModels(
  provider: ProviderRecord,
  forceRefresh = false
): Promise<ProviderModelDefinition[]> {
  const providerType = provider.provider;
  if (isLocalCLIProvider(providerType)) {
    return getLocalCLIModels(providerType, { forceRefresh });
  }
  if (providerType === "custom") {
    if (!provider.customConnection) {
      throw new AIError({
        type: "validation",
        message: "Custom provider connection settings are unavailable",
        retryable: false,
      });
    }
    return discoverCustomProviderModels(provider.customConnection);
  }
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

function getProviderUpdatedAtMs(provider: { updatedAt: Date | null }): number {
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

async function loadStoredCacheEntry(
  provider: Pick<ProviderRecord, "id" | "updatedAt">
): Promise<CachedProviderModels | null> {
  const row = await db.select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, catalogSettingKey(provider.id)))
    .limit(1);
  if (!row[0]?.value) return null;

  try {
    const stored = StoredProviderCatalogSchema.parse(JSON.parse(row[0].value));
    if (stored.providerUpdatedAtMs !== getProviderUpdatedAtMs(provider)) {
      return null;
    }
    const fetchedAtMs = Date.parse(stored.fetchedAt);
    return {
      ...stored,
      expiresAt: fetchedAtMs + MODEL_CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

async function saveStoredCacheEntry(
  provider: ProviderRecord,
  entry: CachedProviderModels
): Promise<void> {
  const value = JSON.stringify(StoredProviderCatalogSchema.parse({
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    providerUpdatedAtMs: entry.providerUpdatedAtMs,
    fetchedAt: entry.fetchedAt,
    models: entry.models,
  }));
  await db.insert(settings).values({
    key: catalogSettingKey(provider.id),
    value,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: settings.key,
    set: { value, updatedAt: new Date() },
  });
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
  return getProviderModelsForResolvedProvider(provider, options);
}

export async function getProviderModelsForResolvedProvider(
  provider: ResolvedProviderCatalogRecord,
  options: GetProviderModelsOptions = {}
): Promise<ProviderModelsResponse> {
  const now = Date.now();
  let cacheEntry = getCacheEntry(provider);
  if (!cacheEntry) {
    cacheEntry = await loadStoredCacheEntry(provider);
    if (cacheEntry) providerModelCache.set(provider.id, cacheEntry);
  }

  if (!options.forceRefresh && cacheEntry && cacheEntry.expiresAt > now) {
    return buildResponse(provider, cacheEntry, "cache", false);
  }

  try {
    const discoveredModels = await fetchProviderModels(provider, options.forceRefresh);
    const models = z.array(ProviderModelDefinitionSchema).max(1_000).parse(discoveredModels);
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
    await saveStoredCacheEntry(provider, freshEntry);

    return buildResponse(provider, freshEntry, "live", false);
  } catch (error) {
    if (cacheEntry && options.allowStaleOnError !== false) {
      const warning = error instanceof Error ? error.message : "Failed to refresh provider models";
      return buildResponse(provider, cacheEntry, "cache", true, warning);
    }

    throw error;
  }
}

export async function getCachedProviderModelDefinition(
  providerId: string,
  modelId: string
): Promise<ProviderModelDefinition | null> {
  const row = await db.select({
    id: aiProviders.id,
    updatedAt: aiProviders.updatedAt,
  }).from(aiProviders).where(and(
    eq(aiProviders.id, providerId),
    eq(aiProviders.isActive, true)
  )).limit(1);
  const provider = row[0];
  if (!provider) return null;

  let entry = providerModelCache.get(provider.id) ?? null;
  if (entry?.providerUpdatedAtMs !== getProviderUpdatedAtMs(provider)) {
    entry = null;
  }
  if (!entry) {
    entry = await loadStoredCacheEntry(provider);
    if (entry) providerModelCache.set(provider.id, entry);
  }

  return entry?.models.find((model) => model.modelId === modelId) ?? null;
}

export async function deleteStoredProviderModelsCache(
  providerId: string,
  database: BetterSQLite3Database<typeof databaseSchema> = db
): Promise<void> {
  clearProviderModelsCache(providerId);
  await database.delete(settings).where(eq(settings.key, catalogSettingKey(providerId)));
}

export async function resolveProviderModelSelection(options: {
  providerId?: string;
  modelId?: string;
}): Promise<ResolvedProviderModelSelection> {
  let provider: ProviderRecord | null = null;

  if (options.providerId) {
    provider = await getProviderRecord(options.providerId);
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
  if (
    requestedModelId &&
    availableModels.length > 0 &&
    !availableModels.some((model) => model.modelId === requestedModelId)
  ) {
    throw new AIError({
      type: "invalid_model",
      message: `Configured model "${requestedModelId}" is unavailable for provider "${provider.provider}"`,
    });
  }

  const resolvedModelId = requestedModelId ?? availableModels[0]?.modelId;

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
