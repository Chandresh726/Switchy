import type { LanguageModel } from "ai";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  getCachedProviderModelDefinition,
  getProviderModelsForResolvedProvider,
  type ProviderReasoningControl,
} from "@/lib/ai/providers/model-catalog";
import { getLocalCLIExecutionTarget } from "@/lib/ai/local-cli/service";
import type { AIGenerationBackend } from "@/lib/ai/local-cli/types";
import { providerRegistry } from "@/lib/ai/providers";
import {
  AIError,
  isAIProvider,
  isReasoningEffort,
  type AIProvider,
  isLocalCLIProvider,
  type ModelConfig,
} from "@/lib/ai/providers/types";
import type { AICapability, ResolvedModelSnapshot } from "@/lib/ai/runtime/types";
import { AISDKGenerationBackend } from "@/lib/ai/runtime/ai-sdk-backend";
import { db } from "@/lib/db";
import { aiProviders, settings } from "@/lib/db/schema";
import { decryptApiKey } from "@/lib/encryption";

export type AIFeature = "job_analysis" | "matcher" | "writing" | "resume_parser";

export interface AIContextOverrides {
  modelId?: string;
  providerId?: string;
  reasoningEffort?: string;
}

export interface ResolvedAIContext extends ResolvedModelSnapshot {
  providerId: string;
  reasoningEffort?: string;
  backend: AIGenerationBackend;
}

interface ResolvedProviderRecord {
  id: string;
  provider: AIProvider;
  apiKey?: string;
  updatedAt: Date | null;
}

const FEATURE_SETTING_KEYS: Record<
  AIFeature,
  { model: string; provider: string; reasoning: string }
> = {
  job_analysis: {
    model: "job_analysis_model",
    provider: "job_analysis_provider_id",
    reasoning: "job_analysis_reasoning_effort",
  },
  matcher: {
    model: "matcher_model",
    provider: "matcher_provider_id",
    reasoning: "matcher_reasoning_effort",
  },
  writing: {
    model: "ai_writing_model",
    provider: "ai_writing_provider_id",
    reasoning: "ai_writing_reasoning_effort",
  },
  resume_parser: {
    model: "resume_parser_model",
    provider: "resume_parser_provider_id",
    reasoning: "resume_parser_reasoning_effort",
  },
};

const CAPABILITY_FEATURES: Record<AICapability, AIFeature> = {
  job_analysis: "job_analysis",
  match_adjudication: "matcher",
  match_evaluation: "matcher",
  writing_cover_letter: "writing",
  writing_referral: "writing",
  writing_recruiter_follow_up: "writing",
  resume_parse: "resume_parser",
};

const modelInitializationFlights = new Map<string, Promise<string>>();

function normalizeOptional(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseReasoningEffort(value?: string | null): string | undefined {
  if (value === undefined || value === null || value.length === 0) return undefined;
  if (isReasoningEffort(value)) return value;

  throw new AIError({
    type: "reasoning_not_supported",
    message: "Configured reasoning effort is invalid; refresh models and choose an advertised value",
    retryable: false,
  });
}

async function getFeatureSettings(feature: AIFeature): Promise<{
  modelId?: string;
  providerId?: string;
  reasoningEffort?: string;
}> {
  const keys = FEATURE_SETTING_KEYS[feature];
  const requestedKeys = [keys.model, keys.provider, keys.reasoning];
  if (feature === "job_analysis") {
    requestedKeys.push(
      FEATURE_SETTING_KEYS.matcher.model,
      FEATURE_SETTING_KEYS.matcher.provider,
      FEATURE_SETTING_KEYS.matcher.reasoning
    );
  }
  const selected = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, requestedKeys));

  const map = new Map(selected.map((row) => [row.key, row.value]));

  return {
    modelId: normalizeOptional(map.get(keys.model)) ??
      (feature === "job_analysis"
        ? normalizeOptional(map.get(FEATURE_SETTING_KEYS.matcher.model))
        : undefined),
    providerId: normalizeOptional(map.get(keys.provider)) ??
      (feature === "job_analysis"
        ? normalizeOptional(map.get(FEATURE_SETTING_KEYS.matcher.provider))
        : undefined),
    reasoningEffort: parseReasoningEffort(
      map.get(keys.reasoning) ??
      (feature === "job_analysis"
        ? map.get(FEATURE_SETTING_KEYS.matcher.reasoning)
        : undefined)
    ),
  };
}

function resolveAdvertisedReasoningEffort(
  requested: string | undefined,
  control: ProviderReasoningControl | undefined,
  modelId: string
): string | undefined {
  if (!requested) {
    return undefined;
  }
  if (!control) {
    throw new AIError({
      type: "reasoning_not_supported",
      message: `Reasoning capabilities are unavailable for model "${modelId}"; refresh models before using the configured value`,
      retryable: false,
    });
  }
  if (control.kind === "provider_default") return undefined;
  if (!control.options.some(({ value }) => value === requested)) {
    throw new AIError({
      type: "reasoning_not_supported",
      message: `Configured reasoning effort "${requested}" is unavailable for model "${modelId}"; refresh models and choose an advertised value`,
      retryable: false,
    });
  }
  return requested;
}

function decryptProviderKey(record: typeof aiProviders.$inferSelect): string | undefined {
  if (!record.apiKey) return undefined;

  try {
    return decryptApiKey(record.apiKey);
  } catch (error) {
    throw new AIError({
      type: "decryption_failed",
      message: `Failed to decrypt API key for provider "${record.provider}"`,
      cause: error instanceof Error ? error : undefined,
    });
  }
}

async function resolveProviderRecord(providerId?: string): Promise<ResolvedProviderRecord> {
  const normalizedProviderId = normalizeOptional(providerId);
  const rows = normalizedProviderId
    ? await db
        .select()
        .from(aiProviders)
        .where(
          and(
            eq(aiProviders.id, normalizedProviderId),
            eq(aiProviders.isActive, true)
          )
        )
        .limit(1)
    : await db
        .select()
        .from(aiProviders)
        .where(eq(aiProviders.isActive, true))
        .orderBy(desc(aiProviders.isDefault), asc(aiProviders.createdAt))
        .limit(100);

  const record = normalizedProviderId
    ? rows[0]
    : rows.find((candidate) => !isLocalCLIProvider(candidate.provider));
  if (!record) {
    throw new AIError({
      type: "provider_not_found",
      message: normalizedProviderId
        ? `Provider "${normalizedProviderId}" not found or inactive`
        : "No active provider configured",
    });
  }

  if (!isAIProvider(record.provider)) {
    throw new AIError({
      type: "provider_not_found",
      message: `Provider "${record.provider}" is not registered`,
    });
  }

  return {
    id: record.id,
    provider: record.provider,
    apiKey: decryptProviderKey(record),
    updatedAt: record.updatedAt,
  };
}

async function initializeConcreteModel(
  provider: ResolvedProviderRecord,
  modelSettingKey?: string
): Promise<string> {
  if (!modelSettingKey) {
    throw new AIError({
      type: "invalid_model",
      message: "A concrete model must be configured for this AI execution",
    });
  }

  const flightKey = `${modelSettingKey}:${provider.id}`;
  const inFlight = modelInitializationFlights.get(flightKey);
  if (inFlight) return inFlight;

  const initialization = (async () => {
    const existing = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, modelSettingKey))
      .limit(1);
    const persistedModel = normalizeOptional(existing[0]?.value);
    if (persistedModel) return persistedModel;

    const catalog = await getProviderModelsForResolvedProvider(provider);
    const modelId = catalog.models[0]?.modelId;
    if (!modelId) {
      throw new AIError({
        type: "invalid_model",
        message: `No supported model is available for provider "${provider.provider}"`,
      });
    }

    await db
      .insert(settings)
      .values({ key: modelSettingKey, value: modelId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: modelId, updatedAt: new Date() },
      });

    return modelId;
  })();
  modelInitializationFlights.set(flightKey, initialization);

  try {
    return await initialization;
  } finally {
    if (modelInitializationFlights.get(flightKey) === initialization) {
      modelInitializationFlights.delete(flightKey);
    }
  }
}

async function resolveAIContext(
  options: AIContextOverrides,
  modelSettingKey?: string
): Promise<ResolvedAIContext> {
  const providerRecord = await resolveProviderRecord(options.providerId);
  const requestedReasoningEffort = parseReasoningEffort(options.reasoningEffort);
  const modelId =
    normalizeOptional(options.modelId) ??
    await initializeConcreteModel(providerRecord, modelSettingKey);
  const provider = providerRegistry.get(providerRecord.provider);

  if (isLocalCLIProvider(providerRecord.provider)) {
    const target = await getLocalCLIExecutionTarget(providerRecord.provider, modelId);
    const reasoningEffort = resolveAdvertisedReasoningEffort(
      requestedReasoningEffort,
      target.reasoningControl,
      modelId
    );
    return {
      providerRecordId: providerRecord.id,
      providerId: providerRecord.id,
      provider: providerRecord.provider,
      modelId,
      reasoningEffort,
      backendKind: providerRecord.provider,
      backend: target.backend,
      cliVersion: target.cliVersion,
      upstreamProvider: target.upstreamProvider,
    };
  }

  if (!provider) {
    throw new AIError({
      type: "provider_not_found",
      message: `Provider "${providerRecord.provider}" is not registered`,
    });
  }
  if (!providerRecord.apiKey && provider.requiresApiKey) {
    throw new AIError({
      type: "missing_api_key",
      message: `API key is required for provider "${providerRecord.provider}"`,
    });
  }

  const cachedModel = await getCachedProviderModelDefinition(providerRecord.id, modelId);
  const reasoningEffort = resolveAdvertisedReasoningEffort(
    requestedReasoningEffort,
    cachedModel?.reasoningControl,
    modelId
  );
  const modelConfig: ModelConfig = {
    modelId,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
  const providerConfig = { apiKey: providerRecord.apiKey };
  const model: LanguageModel = provider.createModel({
    config: modelConfig,
    providerConfig,
  });
  const providerOptions = provider.getGenerationOptions(
    modelConfig,
    providerConfig
  );

  return {
    providerRecordId: providerRecord.id,
    providerId: providerRecord.id,
    provider: providerRecord.provider,
    modelId,
    reasoningEffort,
    backendKind: "ai_sdk",
    backend: new AISDKGenerationBackend(model, providerOptions),
  };
}

async function resolveAIContextForFeature(
  feature: AIFeature,
  overrides: AIContextOverrides = {}
): Promise<ResolvedAIContext> {
  const featureSettings = await getFeatureSettings(feature);
  const keys = FEATURE_SETTING_KEYS[feature];

  return resolveAIContext(
    {
      providerId: normalizeOptional(overrides.providerId) ?? featureSettings.providerId,
      modelId: normalizeOptional(overrides.modelId) ?? featureSettings.modelId,
      reasoningEffort: overrides.reasoningEffort ?? featureSettings.reasoningEffort,
    },
    keys.model
  );
}

export async function resolveAIContextForCapability(
  capability: AICapability,
  overrides: AIContextOverrides = {}
): Promise<ResolvedAIContext> {
  return resolveAIContextForFeature(CAPABILITY_FEATURES[capability], overrides);
}
