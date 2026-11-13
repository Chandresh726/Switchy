"use client";

import { AlertTriangle } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Settings } from "@/lib/api/contracts/settings";
import type { ProviderModelsState } from "@/lib/settings/types";
import type { Provider } from "@/lib/types";

import { ModelCombobox } from "./model-combobox";
import { ReasoningEffortControl, resolveReasoningSelection } from "./reasoning-effort-control";

type FallbackSettingKey = Extract<keyof Settings, `${"job_analysis" | "matcher"}_fallback_${string}`>;
export type FallbackSettings = Pick<Settings, FallbackSettingKey>;

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
  <>
    {([{ stage: "job_analysis", title: "Job analysis fallback" },
      { stage: "matcher", title: "Final match fallback" }] as const).map(({ stage, title }) => {
      const providerId = settings[`${stage}_fallback_provider_id`];
      const modelId = settings[`${stage}_fallback_model`];
      const models = modelsByProvider[providerId];
      const selected = models?.models.find((model) => model.modelId === modelId);
      const enabled = settings[`${stage}_fallback_enabled`] === "true";
      const sameAsPrimary = enabled && providerId === primaryModels?.[stage]?.providerId && modelId === primaryModels?.[stage]?.modelId;
      const incomplete = enabled && (!providerId || !modelId);
      const unavailable = Boolean(modelId) && !selected && !models?.loading;
      return (
        <div key={stage} className="space-y-3 rounded-lg border border-border bg-background/30 p-4">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id={`${stage}-fallback-enabled`}
              checked={enabled}
              onChange={(event) => onChange({ [`${stage}_fallback_enabled`]: String(event.target.checked) })}
              className="mt-1 h-4 w-4 rounded border-border bg-muted text-emerald-500 focus:ring-emerald-500 focus:ring-offset-background"
            />
            <div>
              <Label htmlFor={`${stage}-fallback-enabled`} className="cursor-pointer font-medium">{title}</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Use this model when the primary is unavailable. Paid models use your provider balance.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={providerId} onValueChange={(id) => onChange({
              [`${stage}_fallback_provider_id`]: id ?? "",
              [`${stage}_fallback_model`]: "",
              [`${stage}_fallback_reasoning_effort`]: "",
            })}>
              <SelectTrigger aria-label={`${title} provider`} className="w-[180px] bg-background/60 border-border">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent><SelectGroup>
                {availableProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                ))}
              </SelectGroup></SelectContent>
            </Select>
            <ModelCombobox
              models={models?.models ?? []}
              value={modelId}
              onValueChange={(id) => onChange({
                [`${stage}_fallback_model`]: id,
                [`${stage}_fallback_reasoning_effort`]: resolveReasoningSelection({
                  providerWasEdited: true,
                  model: models?.models.find((model) => model.modelId === id),
                }),
              })}
              disabled={!providerId || models?.loading || !models?.models.length}
              loading={models?.loading ?? false}
              error={models?.error}
              placeholder={`Select ${title.toLowerCase()} model`}
            />
            <ReasoningEffortControl model={selected} value={settings[`${stage}_fallback_reasoning_effort`]}
              onValueChange={(effort) => onChange({ [`${stage}_fallback_reasoning_effort`]: effort })}
              ariaLabel={`${title} reasoning effort`} />
          </div>
          {(sameAsPrimary || incomplete || models?.error || unavailable || models?.isStale) && (
            <p className="flex items-center gap-2 text-xs text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              {sameAsPrimary ? "Choose a different provider or model from the primary." : incomplete ? "Choose a provider and model to enable this fallback." : models?.error ?? (unavailable
                ? "The configured fallback model is unavailable. Choose an available model or refresh the catalog."
                : "Showing cached model list (latest refresh failed)")}
            </p>
          )}
        </div>
      );
    })}
  </>
);
