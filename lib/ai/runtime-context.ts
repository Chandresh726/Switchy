import type { LanguageModel } from "ai";
import { inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

import { getAIGenerationOptions, getAIClientV2 } from "./client";
import { resolveProviderModelSelection } from "./providers/model-catalog";
import type { AIProvider, ReasoningEffort } from "./providers/types";

export type AIFeature = "matcher" | "writing" | "resume_parser";

export interface AIContextOverrides {
  modelId?: string;
  providerId?: string;
  reasoningEffort?: string | ReasoningEffort;
}

export interface ResolvedAIContext {
  model: LanguageModel;
  modelId: string;
  providerId: string;
  provider: AIProvider;
  reasoningEffort: ReasoningEffort;
  providerOptions?: Record<string, unknown>;
}

const FEATURE_SETTING_KEYS: Record<
  AIFeature,
  { model: string; provider: string; reasoning: string }
> = {
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

function normalizeOptional(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseReasoningEffort(value?: string | null): ReasoningEffort {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "medium";
}

async function getFeatureSettings(feature: AIFeature): Promise<{
  modelId?: string;
  providerId?: string;
  reasoningEffort: ReasoningEffort;
}> {
  const keys = FEATURE_SETTING_KEYS[feature];
  const selected = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, [keys.model, keys.provider, keys.reasoning]));

  const map = new Map(selected.map((row) => [row.key, row.value]));

  return {
    modelId: normalizeOptional(map.get(keys.model)),
    providerId: normalizeOptional(map.get(keys.provider)),
    reasoningEffort: parseReasoningEffort(map.get(keys.reasoning)),
  };
}

export async function resolveAIContextFromExplicitConfig(
  options: AIContextOverrides
): Promise<ResolvedAIContext> {
  const resolvedSelection = await resolveProviderModelSelection({
    providerId: normalizeOptional(options.providerId),
    modelId: normalizeOptional(options.modelId),
  });

  const reasoningEffort = parseReasoningEffort(options.reasoningEffort);

  const model = await getAIClientV2({
    modelId: resolvedSelection.modelId,
    reasoningEffort,
    providerId: resolvedSelection.providerId,
  });

  const providerOptions = await getAIGenerationOptions(
    resolvedSelection.modelId,
    reasoningEffort,
    resolvedSelection.providerId
  );

  return {
    model,
    modelId: resolvedSelection.modelId,
    providerId: resolvedSelection.providerId,
    provider: resolvedSelection.provider,
    reasoningEffort,
    providerOptions,
  };
}

export async function resolveAIContextForFeature(
  feature: AIFeature,
  overrides: AIContextOverrides = {}
): Promise<ResolvedAIContext> {
  const featureSettings = await getFeatureSettings(feature);

  return resolveAIContextFromExplicitConfig({
    providerId: normalizeOptional(overrides.providerId) ?? featureSettings.providerId,
    modelId: normalizeOptional(overrides.modelId) ?? featureSettings.modelId,
    reasoningEffort: overrides.reasoningEffort ?? featureSettings.reasoningEffort,
  });
}
