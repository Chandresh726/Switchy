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
import { AlertTriangle, Terminal } from "lucide-react";
import { REASONING_EFFORT_OPTIONS } from "@/lib/ai/providers/metadata";
import type { ReasoningEffort } from "@/lib/settings/types";
import type { Provider, ProviderModelOption } from "@/lib/types";

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
  const supportsReasoning = models.find((model) => model.modelId === resumeParserModel)?.supportsReasoning ?? false;

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
                <Select
                  value={resumeParserModel}
                  onValueChange={onResumeParserModelChange}
                  disabled={modelsLoading || models.length === 0}
                >
                  <SelectTrigger className="flex-1 bg-background/60 border-border">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelsLoading ? (
                      <SelectItem value="loading" disabled>Loading models...</SelectItem>
                    ) : modelsError && models.length === 0 ? (
                      <SelectItem value="error" disabled>Failed to load models</SelectItem>
                    ) : models.length === 0 ? (
                      <SelectItem value="none" disabled>Select a provider first</SelectItem>
                    ) : (
                      models.map((model) => (
                        <SelectItem key={model.modelId} value={model.modelId}>
                          {model.label}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {supportsReasoning && (
                  <Select value={resumeParserReasoningEffort} onValueChange={onResumeParserReasoningEffortChange}>
                    <SelectTrigger className="w-32 bg-background/60 border-border">
                      <SelectValue placeholder="Effort" />
                    </SelectTrigger>
                    <SelectContent>
                      {REASONING_EFFORT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {modelsError && (
                <p className="text-xs text-amber-400 flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {modelsError}
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
