"use client";

import { Terminal } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { ProviderModelFields } from "@/components/settings/provider-model-fields";
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
          <ProviderModelFields
            variant="resume" providers={availableProviders}
            providerId={resumeParserProviderId} onProviderChange={onResumeParserProviderIdChange}
            models={models} loading={modelsLoading} error={modelsError} stale={modelsStale}
            modelId={resumeParserModel} onModelChange={onResumeParserModelChange}
            reasoningEffort={resumeParserReasoningEffort} onReasoningChange={onResumeParserReasoningEffortChange}
          />
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
