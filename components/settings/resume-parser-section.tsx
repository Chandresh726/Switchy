"use client";

import {
  Card,
  CardContent,
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
import { AIProvider, getModelsForProvider, modelSupportsReasoning, REASONING_EFFORT_OPTIONS, ReasoningEffort } from "./constants";

interface ResumeParserSectionProps {
  resumeParserModel: string;
  onResumeParserModelChange: (value: string) => void;
  resumeParserReasoningEffort: ReasoningEffort;
  onResumeParserReasoningEffortChange: (value: ReasoningEffort) => void;
  aiProvider: AIProvider;
}

export function ResumeParserSection({
  resumeParserModel,
  onResumeParserModelChange,
  resumeParserReasoningEffort,
  onResumeParserReasoningEffortChange,
  aiProvider,
}: ResumeParserSectionProps) {
  const supportsReasoning = modelSupportsReasoning(resumeParserModel, aiProvider);

  return (
    <Card className="border-zinc-800 bg-zinc-900/50 rounded-xl">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-purple-500" />
          <CardTitle className="text-base">Resume Parser</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <Label htmlFor="resume-model-select">Parser Model</Label>
          <div className="flex gap-2">
            <Select value={resumeParserModel} onValueChange={onResumeParserModelChange}>
              <SelectTrigger id="resume-model-select" className="flex-1 bg-zinc-950/50 border-zinc-800">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {getModelsForProvider(aiProvider).map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{model.label}</span>
                    </div>
                  </SelectItem>
                ))}
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
          <p className="text-xs text-zinc-500">
            Model used for extracting data from resumes.
            {supportsReasoning && " Reasoning effort controls analysis depth."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
