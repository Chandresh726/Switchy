import { resolveReasoningSelection } from "@/components/settings/reasoning-effort-control";
import type {
  ProviderSettingsListItem,
  Settings,
} from "@/lib/api/contracts/settings";
import type {
  ProviderModelsState,
  ReasoningEffort,
} from "@/lib/settings/types";

export const AI_MODEL_FEATURES = {
  job_analysis: {
    label: "Job Analysis",
    provider: "job_analysis_provider_id",
    model: "job_analysis_model",
    reasoning: "job_analysis_reasoning_effort",
  },
  matcher: {
    label: "Matcher",
    provider: "matcher_provider_id",
    model: "matcher_model",
    reasoning: "matcher_reasoning_effort",
  },
  resume_parser: {
    label: "Resume Parser",
    provider: "resume_parser_provider_id",
    model: "resume_parser_model",
    reasoning: "resume_parser_reasoning_effort",
  },
  ai_writing: {
    label: "AI Writing",
    provider: "ai_writing_provider_id",
    model: "ai_writing_model",
    reasoning: "ai_writing_reasoning_effort",
  },
} as const;

type ModelFeature = keyof typeof AI_MODEL_FEATURES;
interface FeatureModelEdits {
  providerId?: string;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
}

export function resolveFeatureModel(
  feature: ModelFeature,
  edits: FeatureModelEdits,
  settings: Settings | undefined,
  providers: ProviderSettingsListItem[],
  catalogs: Record<string, ProviderModelsState>,
) {
  const keys = AI_MODEL_FEATURES[feature];
  const savedProviderIds = Object.values(AI_MODEL_FEATURES).map(
    ({ provider }) => settings?.[provider],
  );
  const candidates = providers.filter(
    (provider) => provider.selectable || savedProviderIds.includes(provider.id),
  );
  const fallback =
    feature === "job_analysis" ? AI_MODEL_FEATURES.matcher : undefined;
  const savedProviderId =
    settings?.[keys.provider] || (fallback && settings?.[fallback.provider]);
  const savedModel =
    settings?.[keys.model] || (fallback && settings?.[fallback.model]);
  const savedReasoning =
    settings?.[keys.reasoning] || (fallback && settings?.[fallback.reasoning]);
  const candidateId =
    edits.providerId || savedProviderId || candidates[0]?.id || "";
  const providerId =
    candidates.find(({ id }) => id === candidateId)?.id ??
    candidates[0]?.id ??
    "";
  const catalog = catalogs[providerId];
  const keepSavedModel =
    savedModel &&
    (!savedProviderId ||
      savedProviderId === providerId ||
      catalog?.models.some(({ modelId }) => modelId === savedModel));
  const modelId =
    edits.modelId ||
    (keepSavedModel ? savedModel : catalog?.models[0]?.modelId) ||
    "";
  const reasoningEffort =
    edits.reasoningEffort !== undefined
      ? edits.reasoningEffort
      : edits.providerId === undefined
        ? savedReasoning || ""
        : resolveReasoningSelection({
            localValue: edits.reasoningEffort,
            savedValue: savedReasoning,
            providerWasEdited: true,
            model: catalog?.models.find((model) => model.modelId === modelId),
          });
  return {
    providerId,
    modelId,
    reasoningEffort,
    localProviderEdited: edits.providerId !== undefined,
    localModelEdited: edits.modelId !== undefined,
  };
}
