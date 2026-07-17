"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModelCombobox } from "@/components/settings/model-combobox";
import {
  hasInvalidReasoningSelection,
  ReasoningEffortControl,
} from "@/components/settings/reasoning-effort-control";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, FileText, MessageCircle, Send, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReasoningEffort } from "@/lib/settings/types";
import type { ProviderModelOption } from "@/lib/api/contracts/settings";
import type { Provider } from "@/lib/types";

export interface AIWritingSettings {
  referralTone: string;
  referralLength: string;
  followUpTone: string;
  followUpLength: string;
  coverLetterTone: string;
  coverLetterLength: string;
  coverLetterFocus: string[];
  aiWritingModel: string;
  aiWritingProviderId: string;
  aiWritingReasoningEffort: ReasoningEffort;
}

interface AIWritingSectionProps {
  availableProviders: Provider[];
  hasProviders: boolean;
  models: ProviderModelOption[];
  modelsLoading: boolean;
  modelsError?: string;
  modelsStale: boolean;
  aiWritingProviderId: string;
  onAIWritingProviderIdChange: (value: string) => void;
  aiWritingSettings: AIWritingSettings;
  onAIWritingSettingsChange: (settings: Partial<AIWritingSettings>) => void;
}

const REFERRAL_TONE_OPTIONS = [
  { value: "professional", label: "Professional" },
  { value: "casual", label: "Casual" },
  { value: "friendly", label: "Friendly" },
  { value: "flexible", label: "Flexible" },
];

const REFERRAL_LENGTH_OPTIONS = [
  { value: "short", label: "Short" },
  { value: "medium", label: "Medium" },
  { value: "long", label: "Long" },
];

const FOLLOW_UP_TONE_OPTIONS = REFERRAL_TONE_OPTIONS;
const FOLLOW_UP_LENGTH_OPTIONS = REFERRAL_LENGTH_OPTIONS;

const COVER_LETTER_TONE_OPTIONS = [
  { value: "professional", label: "Professional" },
  { value: "formal", label: "Formal" },
  { value: "casual", label: "Casual" },
  { value: "flexible", label: "Flexible" },
];

const COVER_LETTER_LENGTH_OPTIONS = [
  { value: "short", label: "Short" },
  { value: "medium", label: "Medium" },
  { value: "long", label: "Long" },
];

const COVER_LETTER_FOCUS_OPTIONS = [
  { value: "skills", label: "Skills" },
  { value: "experience", label: "Experience" },
  { value: "cultural_fit", label: "Cultural Fit" },
];

const DEFAULT_FOCUS = ["skills", "experience", "cultural_fit"];

export function AIWritingSection({
  availableProviders,
  hasProviders,
  models,
  modelsLoading,
  modelsError,
  modelsStale,
  aiWritingProviderId,
  onAIWritingProviderIdChange,
  aiWritingSettings,
  onAIWritingSettingsChange,
}: AIWritingSectionProps) {
  const currentModel = aiWritingSettings.aiWritingModel;
  const selectedModel = models.find((model) => model.modelId === currentModel);
  const reasoningSelectionInvalid = hasInvalidReasoningSelection(
    selectedModel,
    aiWritingSettings.aiWritingReasoningEffort
  );
  const configuredModelUnavailable = Boolean(currentModel) && !selectedModel;

  const toggleFocus = (value: string) => {
    const current = aiWritingSettings.coverLetterFocus || [];
    const newFocus = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value];
    onAIWritingSettingsChange({ coverLetterFocus: newFocus });
  };

  const isFocusSelected = (value: string) => {
    const current = aiWritingSettings.coverLetterFocus || DEFAULT_FOCUS;
    return current.includes(value);
  };

  return (
    <Card className="border-border bg-card/70 rounded-xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-purple-500" />
          <CardTitle>AI Writing</CardTitle>
        </div>
        <CardDescription>
          Configure AI-generated referral messages, recruiter follow-ups, and cover letters
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {hasProviders ? (
          <>
            <div className="space-y-3">
              <Label>AI Provider & Model</Label>
              <div className="flex gap-2">
                <Select value={aiWritingProviderId} onValueChange={onAIWritingProviderIdChange}>
                  <SelectTrigger className="w-[180px] bg-background/60 border-border">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {availableProviders.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <ModelCombobox
                  models={models}
                  value={currentModel}
                  onValueChange={(value) => {
                    const model = models.find((candidate) => candidate.modelId === value);
                    const defaultReasoningEffort = model?.reasoningControl.kind === "effort"
                      ? model.reasoningControl.defaultValue ?? model.reasoningControl.options[0]?.value ?? ""
                      : "";
                    onAIWritingSettingsChange({
                      aiWritingModel: value,
                      aiWritingReasoningEffort: defaultReasoningEffort,
                    });
                  }}
                  disabled={modelsLoading || models.length === 0}
                  loading={modelsLoading}
                  error={modelsError}
                  placeholder="Select model"
                />
                <ReasoningEffortControl
                  model={selectedModel}
                  value={aiWritingSettings.aiWritingReasoningEffort}
                  onValueChange={(value) => onAIWritingSettingsChange({ aiWritingReasoningEffort: value })}
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
              {reasoningSelectionInvalid && (
                <p className="text-xs text-destructive flex items-center gap-2">
                  <AlertTriangle />
                  Choose a reasoning value advertised by this model.
                </p>
              )}
              {modelsStale && !modelsError && (
                <p className="text-xs text-amber-400 flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Showing cached model list (latest refresh failed)
                </p>
              )}
            </div>

            <Separator className="bg-muted" />

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-emerald-400" />
                <h3 className="text-sm font-medium text-foreground">Cover Letter</h3>
              </div>

              <div className="grid gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="space-y-2 sm:flex-1 sm:min-w-0">
                    <Label className="text-muted-foreground">Tone</Label>
                    <Select
                      value={aiWritingSettings.coverLetterTone}
                      onValueChange={(value) => onAIWritingSettingsChange({ coverLetterTone: value })}
                    >
                      <SelectTrigger className="w-full bg-background/60 border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {COVER_LETTER_TONE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 sm:flex-1 sm:min-w-0">
                    <Label className="text-muted-foreground">Length</Label>
                    <Select
                      value={aiWritingSettings.coverLetterLength}
                      onValueChange={(value) => onAIWritingSettingsChange({ coverLetterLength: value })}
                    >
                      <SelectTrigger className="w-full bg-background/60 border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {COVER_LETTER_LENGTH_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 sm:flex-[2] sm:min-w-0">
                    <Label className="text-muted-foreground">Focus</Label>
                    <div className="flex gap-2">
                      {COVER_LETTER_FOCUS_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => toggleFocus(option.value)}
                          className={cn(
                            "inline-flex flex-1 items-center justify-center px-3 py-1.5 text-xs font-medium transition-colors",
                            isFocusSelected(option.value)
                              ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30"
                              : "bg-muted text-muted-foreground hover:bg-muted hover:text-foreground/80"
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <Separator className="bg-muted" />

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-purple-400" />
                <h3 className="text-sm font-medium text-foreground">Referral Message</h3>
              </div>

              <div className="grid gap-4">
                <div className="flex gap-4 items-end">
                  <div className="flex gap-3 flex-1">
                    <div className="space-y-2 flex-1">
                      <Label className="text-muted-foreground">Tone</Label>
                      <Select
                        value={aiWritingSettings.referralTone}
                        onValueChange={(value) => onAIWritingSettingsChange({ referralTone: value })}
                      >
                        <SelectTrigger className="w-full bg-background/60 border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {REFERRAL_TONE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2 flex-1">
                      <Label className="text-muted-foreground">Length</Label>
                      <Select
                        value={aiWritingSettings.referralLength}
                        onValueChange={(value) => onAIWritingSettingsChange({ referralLength: value })}
                      >
                        <SelectTrigger className="w-full bg-background/60 border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {REFERRAL_LENGTH_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <Separator className="bg-muted" />

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Send className="h-4 w-4 text-blue-400" />
                <h3 className="text-sm font-medium text-foreground">Recruiter Follow-up</h3>
              </div>

              <div className="grid gap-4">
                <div className="flex gap-4 items-end">
                  <div className="flex gap-3 flex-1">
                    <div className="space-y-2 flex-1">
                      <Label className="text-muted-foreground">Tone</Label>
                      <Select
                        value={aiWritingSettings.followUpTone}
                        onValueChange={(value) => onAIWritingSettingsChange({ followUpTone: value })}
                      >
                        <SelectTrigger className="w-full bg-background/60 border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {FOLLOW_UP_TONE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2 flex-1">
                      <Label className="text-muted-foreground">Length</Label>
                      <Select
                        value={aiWritingSettings.followUpLength}
                        onValueChange={(value) => onAIWritingSettingsChange({ followUpLength: value })}
                      >
                        <SelectTrigger className="w-full bg-background/60 border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {FOLLOW_UP_LENGTH_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 px-4 rounded-lg border border-dashed border-border bg-background/20">
            <Wand2 className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm font-medium">No AI Provider configured</p>
            <p className="text-muted-foreground text-xs mt-1">Add an AI Provider above to use AI Writing</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
