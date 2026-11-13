"use client";

import { AlertTriangle } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Settings, ProviderModelOption } from "@/lib/api/contracts/settings";
import type { ProviderModelsState } from "@/lib/settings/types";
import type { Provider } from "@/lib/types";

import { ModelCombobox } from "./model-combobox";
import { ReasoningEffortControl, resolveReasoningSelection } from "./reasoning-effort-control";

type FallbackSettingKey = Extract<keyof Settings, `${"job_analysis" | "matcher"}_fallback_${string}`>;
export type FallbackSettings = Pick<Settings, FallbackSettingKey>;

const DISABLED_PROVIDER = "__disabled_fallback__";

const NO_FALLBACK_MODEL: ProviderModelOption = {
  modelId: "__no_fallback__",
  label: "None",
  description: "",
  supportsReasoning: false,
  reasoningControl: { kind: "provider_default" },
};

interface MatcherFallbackSettingsProps {
  settings: FallbackSettings;
  availableProviders: Provider[];
  modelsByProvider: Record<string, ProviderModelsState>;
  primaryModels?: Partial<Record<"job_analysis" | "matcher", { providerId: string; modelId: string }>>;
  onChange: (updates: Partial<FallbackSettings>) => void;
}

export const MatcherFallbackSettings = ({
  settings, availableProviders, modelsByProvider, primaryModels, onChange,
}: MatcherFallbackSettingsProps) => (
  <div className="space-y-4 rounded-lg border border-border bg-background/30 p-4">
    {([{ stage: "job_analysis", title: "Job analysis fallback" },
      { stage: "matcher", title: "Final match fallback" }] as const).map(({ stage, title }) => {
      const providerId = settings[`${stage}_fallback_provider_id`];
      const modelId = settings[`${stage}_fallback_enabled`] === "true" ? settings[`${stage}_fallback_model`] : "";
      const models = modelsByProvider[providerId];
      const selected = models?.models.find((model) => model.modelId === modelId);
      const enabled = Boolean(modelId);
      const sameAsPrimary = enabled && providerId === primaryModels?.[stage]?.providerId && modelId === primaryModels?.[stage]?.modelId;
      const unavailable = Boolean(modelId) && !selected && !models?.loading;
      return (
        <div key={stage} className="space-y-2">
          <Label>{title}</Label>
          <div className="flex flex-wrap gap-2">
            <Select value={providerId || DISABLED_PROVIDER} onValueChange={(id) => onChange({
              [`${stage}_fallback_provider_id`]: id === DISABLED_PROVIDER ? "" : id ?? "",
              [`${stage}_fallback_enabled`]: "false",
              [`${stage}_fallback_model`]: "",
              [`${stage}_fallback_reasoning_effort`]: "",
            })}>
              <SelectTrigger aria-label={`${title} provider`} className="w-[180px] bg-background/60 border-border">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value={DISABLED_PROVIDER}>Disabled</SelectItem>
                {availableProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                ))}
              </SelectGroup></SelectContent>
            </Select>
            <ModelCombobox
              models={[NO_FALLBACK_MODEL, ...(models?.models ?? [])]}
              value={modelId || NO_FALLBACK_MODEL.modelId}
              onValueChange={(id) => {
                const nextModel = id === NO_FALLBACK_MODEL.modelId ? "" : id;
                onChange({
                  [`${stage}_fallback_model`]: nextModel,
                  [`${stage}_fallback_enabled`]: String(Boolean(nextModel)),
                  [`${stage}_fallback_reasoning_effort`]: nextModel ? resolveReasoningSelection({
                    providerWasEdited: true,
                    model: models?.models.find((model) => model.modelId === nextModel),
                  }) : "",
                });
              }}
              disabled={!providerId && !modelId}
              loading={Boolean(models?.loading && !modelId)}
              ariaLabel={`${title} model`}
              error={models?.error}
              placeholder={`Select ${title.toLowerCase()} model`}
            />
            <ReasoningEffortControl model={selected} value={settings[`${stage}_fallback_reasoning_effort`]}
              onValueChange={(effort) => onChange({ [`${stage}_fallback_reasoning_effort`]: effort })}
              ariaLabel={`${title} reasoning effort`} />
          </div>
          {(sameAsPrimary || models?.error || unavailable || models?.isStale) && (
            <p className="flex items-center gap-2 text-xs text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              {sameAsPrimary ? "Choose a different provider or model from the primary." : models?.error ?? (unavailable
                ? "The configured fallback model is unavailable. Choose an available model or refresh the catalog."
                : "Showing cached model list (latest refresh failed)")}
            </p>
          )}
        </div>
      );
    })}
  </div>
);
