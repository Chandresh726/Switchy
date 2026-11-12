"use client";

import { useState } from "react";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { patchSettings } from "@/lib/api/clients/settings";
import type { Settings, ProviderSettingsListItem } from "@/lib/api/contracts/settings";
import { queryKeys } from "@/lib/query-keys";
import type { ProviderModelsState } from "@/lib/settings/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { ModelCombobox } from "./model-combobox";
import { ReasoningEffortControl } from "./reasoning-effort-control";

interface MatcherFallbackSettingsProps {
  settings: Settings;
  providers: ProviderSettingsListItem[];
  modelsByProvider: Record<string, ProviderModelsState>;
}

interface FallbackStageProps extends MatcherFallbackSettingsProps {
  stage: "job_analysis" | "matcher";
  title: string;
}

const FallbackStage = ({ settings, providers, modelsByProvider, stage, title }: FallbackStageProps) => {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const value = (key: "enabled" | "provider_id" | "model" | "reasoning_effort") =>
    edits[key] ?? settings[`${stage}_fallback_${key}`];
  const enabled = value("enabled") === "true";
  const providerId = value("provider_id");
  const modelId = value("model");
  const models = modelsByProvider[providerId];
  const selected = models?.models.find((model) => model.modelId === modelId);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => patchSettings(Object.fromEntries(
      (["enabled", "provider_id", "model", "reasoning_effort"] as const)
        .map((key) => [`${stage}_fallback_${key}`, value(key)])
    )),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.settings.detail(), updated);
      setEdits({});
      toast.success(`${title} fallback saved`);
    },
    onError: (error) => toast.error(error.message),
  });
  return <div className="space-y-4 rounded-lg border p-4">
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={`${stage}-fallback-enabled`}>{title} fallback</Label>
      <Switch id={`${stage}-fallback-enabled`} checked={enabled}
        onCheckedChange={(checked) => setEdits({ ...edits, enabled: String(checked) })} />
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2"><Label>Fallback provider</Label>
        <Select value={providerId} onValueChange={(id) => setEdits({ ...edits, provider_id: id ?? "", model: "", reasoning_effort: "" })}>
          <SelectTrigger aria-label={`${title} fallback provider`}><SelectValue placeholder="Choose provider" /></SelectTrigger>
          <SelectContent>{providers.filter((provider) => provider.kind !== "local_cli" || provider.selectable).map((provider) =>
            <SelectItem key={provider.id} value={provider.id}>{provider.displayName ?? provider.provider}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2"><Label>Fallback model</Label>
        <ModelCombobox models={models?.models ?? []} value={modelId}
          onValueChange={(id) => setEdits({ ...edits, model: id, reasoning_effort: "" })}
          disabled={!providerId} loading={models?.loading ?? false} />
      </div>
    </div>
    <ReasoningEffortControl model={selected} value={value("reasoning_effort")}
      onValueChange={(effort) => setEdits({ ...edits, reasoning_effort: effort })} />
    {models?.error && <p className="text-sm text-destructive">{models.error}</p>}
    {enabled && providerId.startsWith("builtin:opencode") && modelId.startsWith("opencode/") &&
      <p className="text-sm text-muted-foreground">Models on the same service may share a quota. A different provider gives better outage coverage.</p>}
    <Button disabled={save.isPending || (enabled && !selected)} onClick={() => save.mutate()}>
      {save.isPending ? "Saving…" : `Save ${title.toLowerCase()} fallback`}
    </Button>
  </div>;
};

export const MatcherFallbackSettings = (props: MatcherFallbackSettingsProps) => <Card>
  <CardHeader><CardTitle>Matching fallbacks</CardTitle>
    <CardDescription>Use a second model when the primary is unavailable or repeatedly returns invalid output. Paid models use your provider balance. Both models use the same quality checks.</CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    <FallbackStage {...props} stage="job_analysis" title="Job analysis" />
    <FallbackStage {...props} stage="matcher" title="Match evaluation" />
  </CardContent>
</Card>;
