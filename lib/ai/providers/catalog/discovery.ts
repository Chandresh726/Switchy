import { z } from "zod";

import { AIError } from "@/lib/ai/shared/errors";

import { buildCustomRequestHeaders, type CustomProviderConnection } from "../custom-config";
import { cancelCustomProviderResponse, customProviderFetch } from "../custom-fetch";
import { createEffortReasoningControl, withReasoningControl, type ProviderReasoningControl } from "../reasoning-controls";
import type { ProviderModelDefinition } from "../model-contract";
import type { AIProvider } from "../types";
import type { ResolvedProviderCatalogRecord as ProviderRecord } from "./types";

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
      signal: options.signal ?? AbortSignal.timeout(10_000),
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
  const payload = connection.modelDiscovery === "manual"
    ? { data: [] }
    : await fetchJson<unknown>(
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

export async function discoverProviderModels(
  provider: ProviderRecord,
): Promise<ProviderModelDefinition[]> {
  const providerType = provider.provider;
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
