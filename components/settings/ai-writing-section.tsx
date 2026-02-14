"use client";

import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { FileText, MessageCircle, Wand2, Save, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { REASONING_EFFORT_OPTIONS, ReasoningEffort, getModelsForProvider, getDefaultModelForProvider, AIProvider } from "./constants";

export interface AIWritingSettings {
  referralTone: string;
  referralLength: string;
  coverLetterTone: string;
  coverLetterLength: string;
  coverLetterFocus: string[];
  aiWritingModel: string;
  aiWritingReasoningEffort: ReasoningEffort;
}

interface AIWritingSectionProps {
  aiWritingSettings: AIWritingSettings;
  onAIWritingSettingsChange: (settings: Partial<AIWritingSettings>) => void;
  aiProvider: AIProvider;
  onSave: () => void;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  settingsSaved: boolean;
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
  aiWritingSettings,
  onAIWritingSettingsChange,
  aiProvider,
  onSave,
  isSaving,
  hasUnsavedChanges,
  settingsSaved,
}: AIWritingSectionProps) {
  const provider = aiProvider || "anthropic";
  const availableModels = getModelsForProvider(provider);
  const defaultModel = getDefaultModelForProvider(provider);
  const currentModel = aiWritingSettings.aiWritingModel || defaultModel;
  const supportsReasoning = availableModels.find(m => m.id === currentModel)?.supportsReasoning ?? false;

  useEffect(() => {
    if (!aiWritingSettings.aiWritingModel && defaultModel) {
      onAIWritingSettingsChange({ aiWritingModel: defaultModel });
    }
    // Only run when provider changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiProvider]);

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
    <Card className="border-zinc-800 bg-zinc-900/50 rounded-xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-purple-500" />
          <CardTitle>AI Writing</CardTitle>
        </div>
        <CardDescription>
          Configure AI-generated referral messages and cover letters
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label>AI Model</Label>
          <div className="flex gap-2">
            <Select 
              value={currentModel} 
              onValueChange={(value) => onAIWritingSettingsChange({ aiWritingModel: value })}
            >
              <SelectTrigger className="flex-1 bg-zinc-950/50 border-zinc-800">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{model.label}</span>
                      <span className="text-zinc-600 text-xs">•</span>
                      <span className="text-xs text-zinc-400">{model.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {supportsReasoning && (
              <Select 
                value={aiWritingSettings.aiWritingReasoningEffort || "medium"} 
                onValueChange={(value) => onAIWritingSettingsChange({ aiWritingReasoningEffort: value as ReasoningEffort })}
              >
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
            Model used for generating referral messages and cover letters.
            {supportsReasoning && " Reasoning effort controls the depth of AI analysis."}
          </p>
        </div>

        <Separator className="bg-zinc-800" />

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-medium text-white">Cover Letter</h3>
          </div>
          
          <div className="grid gap-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label className="text-zinc-400">Tone</Label>
                <Select
                  value={aiWritingSettings.coverLetterTone}
                  onValueChange={(value) => onAIWritingSettingsChange({ coverLetterTone: value })}
                >
                  <SelectTrigger className="w-full bg-zinc-950/50 border-zinc-800">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COVER_LETTER_TONE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label className="text-zinc-400">Length</Label>
                <Select
                  value={aiWritingSettings.coverLetterLength}
                  onValueChange={(value) => onAIWritingSettingsChange({ coverLetterLength: value })}
                >
                  <SelectTrigger className="w-full bg-zinc-950/50 border-zinc-800">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COVER_LETTER_LENGTH_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-zinc-400">Focus</Label>
                <div className="flex flex-wrap gap-2">
                  {COVER_LETTER_FOCUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => toggleFocus(option.value)}
                      className={cn(
                        "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                        isFocusSelected(option.value)
                          ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
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

        <Separator className="bg-zinc-800" />

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-purple-400" />
            <h3 className="text-sm font-medium text-white">Referral Message</h3>
          </div>
          
          <div className="grid gap-4">
            <div className="flex gap-4 items-end">
              <div className="flex gap-3 flex-1">
                <div className="space-y-2 flex-1">
                  <Label className="text-zinc-400">Tone</Label>
                  <Select
                    value={aiWritingSettings.referralTone}
                    onValueChange={(value) => onAIWritingSettingsChange({ referralTone: value })}
                  >
                    <SelectTrigger className="w-full bg-zinc-950/50 border-zinc-800">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REFERRAL_TONE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2 flex-1">
                  <Label className="text-zinc-400">Length</Label>
                  <Select
                    value={aiWritingSettings.referralLength}
                    onValueChange={(value) => onAIWritingSettingsChange({ referralLength: value })}
                  >
                    <SelectTrigger className="w-full bg-zinc-950/50 border-zinc-800">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REFERRAL_LENGTH_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      <CardFooter className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/50 px-6 py-4 rounded-b-xl">
        <p className="text-xs text-zinc-500">
          {settingsSaved ? (
            <span className="flex items-center text-emerald-400 gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Changes saved successfully
            </span>
          ) : hasUnsavedChanges ? (
            <span className="text-yellow-400">Unsaved changes</span>
          ) : (
            "Settings are up to date"
          )}
        </p>
        <Button
          onClick={onSave}
          disabled={isSaving || !hasUnsavedChanges}
          className="bg-emerald-600 hover:bg-emerald-500 text-white min-w-[120px]"
        >
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </CardFooter>
    </Card>
  );
}
