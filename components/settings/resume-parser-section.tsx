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
import { Terminal } from "lucide-react";
import { getModelsForProvider, modelSupportsReasoning } from "@/lib/ai/providers/models";
import { REASONING_EFFORT_OPTIONS } from "@/lib/ai/providers/metadata";
import type { ReasoningEffort, AIProvider } from "@/lib/ai/providers/types";
import type { Provider } from "@/lib/types";
import { useMemo } from "react";

interface ResumeParserSectionProps {
  availableProviders: Provider[];
  hasProviders: boolean;
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
  resumeParserProviderId,
  onResumeParserProviderIdChange,
  resumeParserModel,
  onResumeParserModelChange,
  resumeParserReasoningEffort,
  onResumeParserReasoningEffortChange,
}: ResumeParserSectionProps) {
  const currentProvider = availableProviders.find(p => p.id === resumeParserProviderId);
  const providerType = currentProvider?.provider as AIProvider | undefined;
  const models = useMemo(() => {
    if (!providerType) return [];
    return getModelsForProvider(providerType);
  }, [providerType]);

  const supportsReasoning = providerType ? modelSupportsReasoning(providerType, resumeParserModel) : false;

  return (
    <Card className="border-zinc-800 bg-zinc-900/50 rounded-xl">
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
                <SelectTrigger className="w-full bg-zinc-950/50 border-zinc-800">
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
                <Select value={resumeParserModel} onValueChange={onResumeParserModelChange}>
                  <SelectTrigger className="flex-1 bg-zinc-950/50 border-zinc-800">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.length === 0 ? (
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
                    <SelectTrigger className="w-32 bg-zinc-950/50 border-zinc-800">
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
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 px-4 rounded-lg border border-dashed border-zinc-800 bg-zinc-950/20">
            <Terminal className="h-10 w-10 text-zinc-600 mb-3" />
            <p className="text-zinc-400 text-sm font-medium">No AI Provider configured</p>
            <p className="text-zinc-500 text-xs mt-1">Add an AI Provider above to use the Resume Parser</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
