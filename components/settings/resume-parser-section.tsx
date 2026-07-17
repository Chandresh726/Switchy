"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelCombobox } from "@/components/settings/model-combobox";
import { ReasoningEffortControl } from "@/components/settings/reasoning-effort-control";
import { AlertTriangle, Terminal } from "lucide-react";
import type { ReasoningEffort } from "@/lib/settings/types";
import type { ProviderModelOption } from "@/lib/api/contracts/settings";
import type { Provider } from "@/lib/types";

interface ResumeParserSectionProps {
  availableProviders: Provider[];
  hasProviders: boolean;
  models: ProviderModelOption[];
  modelsLoading: boolean;
  modelsError?: string;
  modelsStale: boolean;
  resumeParserProviderId: string;
  onResumeParserProviderIdChange: (value: string) => void;
  resumeParserModel: string;
  onResumeParserModelChange: (value: string) => void;
  resumeParserReasoningEffort: ReasoningEffort;
  onResumeParserReasoningEffortChange: (value: ReasoningEffort) => void;
}

export function ResumeParserSection({
  availableProviders,
  hasProviders,
  models,
  modelsLoading,
  modelsError,
  modelsStale,
  resumeParserProviderId,
  onResumeParserProviderIdChange,
  resumeParserModel,
  onResumeParserModelChange,
  resumeParserReasoningEffort,
  onResumeParserReasoningEffortChange,
}: ResumeParserSectionProps) {
  const selectedModel = models.find((model) => model.modelId === resumeParserModel);
  const configuredModelUnavailable = Boolean(resumeParserModel) && !selectedModel;

  return (
    <Card className="border-border bg-card/70 rounded-xl">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-purple-500" />
          <CardTitle className="text-base">Resume Parser</CardTitle>
        </div>
        <CardDescription className="text-xs">
          Configure AI model for parsing resumes
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasProviders ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>AI Provider</Label>
              <Select value={resumeParserProviderId} onValueChange={onResumeParserProviderIdChange}>
                <SelectTrigger className="w-full bg-background/60 border-border">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {availableProviders.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Model</Label>
              <div className="flex gap-2">
                <ModelCombobox
                  models={models}
                  value={resumeParserModel}
                  onValueChange={onResumeParserModelChange}
                  disabled={modelsLoading || models.length === 0}
                  loading={modelsLoading}
                  error={modelsError}
                  placeholder="Select model"
                />
                <ReasoningEffortControl
                  model={selectedModel}
                  value={resumeParserReasoningEffort}
                  onValueChange={onResumeParserReasoningEffortChange}
                />
              </div>
              {modelsError && (
                <p className="text-xs text-amber-400 flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {modelsError}
                </p>
              )}
              {configuredModelUnavailable && (
                <p className="text-xs text-amber-400 flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  The configured model is unavailable. Choose another model or refresh the catalog.
                </p>
              )}
              {modelsStale && !modelsError && (
                <p className="text-xs text-amber-400 flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Showing cached model list (latest refresh failed)
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 px-4 rounded-lg border border-dashed border-border bg-background/20">
            <Terminal className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm font-medium">No AI Provider configured</p>
            <p className="text-muted-foreground text-xs mt-1">Add an AI Provider above to use the Resume Parser</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
