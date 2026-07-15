"use client";

import { useState } from "react";

import { AlertTriangle, Cpu, Loader2, Save, Settings2, Sparkles } from "lucide-react";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModelCombobox } from "@/components/settings/model-combobox";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { REASONING_EFFORT_OPTIONS } from "@/lib/ai/providers/metadata";
import type { MatchQualityPreset } from "@/lib/ai/matcher/types";
import type { ReasoningEffort } from "@/lib/settings/types";
import type { Provider, ProviderModelOption } from "@/lib/types";

interface MatcherSectionProps {
  availableProviders: Provider[];
  hasProviders: boolean;
  models: ProviderModelOption[];
  modelsLoading: boolean;
  modelsError?: string;
  modelsStale: boolean;
  matcherProviderId: string;
  onMatcherProviderIdChange: (value: string) => void;
  matcherModel: string;
  onMatcherModelChange: (value: string) => void;
  matcherReasoningEffort: ReasoningEffort;
  onMatcherReasoningEffortChange: (value: ReasoningEffort) => void;
  qualityPreset: MatchQualityPreset;
  onQualityPresetChange: (value: MatchQualityPreset) => void;
  acceptedLocationTypes: string[];
  onAcceptedLocationTypesChange: (value: string[]) => void;
  acceptedEmploymentTypes: string[];
  onAcceptedEmploymentTypesChange: (value: string[]) => void;
  autoMatchAfterScrape: boolean;
  onAutoMatchAfterScrapeChange: (value: boolean) => void;
  batchSize: number;
  onBatchSizeChange: (value: number) => void;
  maxRetries: number;
  onMaxRetriesChange: (value: number) => void;
  concurrencyLimit: number;
  onConcurrencyLimitChange: (value: number) => void;
  timeoutMs: number;
  onTimeoutMsChange: (value: number) => void;
  onSave: () => void;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  settingsSaved: boolean;
  onMatchUnmatched: () => void;
  isMatching: boolean;
  matchProgress?: { completed: number; total: number; succeeded: number; failed: number };
  unmatchedCount: number;
}

export function MatcherSection({
  availableProviders,
  hasProviders,
  models,
  modelsLoading,
  modelsError,
  modelsStale,
  matcherProviderId,
  onMatcherProviderIdChange,
  matcherModel,
  onMatcherModelChange,
  matcherReasoningEffort,
  onMatcherReasoningEffortChange,
  qualityPreset,
  onQualityPresetChange,
  acceptedLocationTypes,
  onAcceptedLocationTypesChange,
  acceptedEmploymentTypes,
  onAcceptedEmploymentTypesChange,
  autoMatchAfterScrape,
  onAutoMatchAfterScrapeChange,
  batchSize,
  onBatchSizeChange,
  maxRetries,
  onMaxRetriesChange,
  concurrencyLimit,
  onConcurrencyLimitChange,
  timeoutMs,
  onTimeoutMsChange,
  onSave,
  isSaving,
  hasUnsavedChanges,
  settingsSaved,
  onMatchUnmatched,
  isMatching,
  matchProgress,
  unmatchedCount,
}: MatcherSectionProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const supportsReasoning = models.find((model) => model.modelId === matcherModel)?.supportsReasoning ?? false;
  const toggleValue = (
    current: string[],
    value: string,
    onChange: (next: string[]) => void
  ) => onChange(current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value]);

  return (
    <Card className="border-border bg-card/70 rounded-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-emerald-500" />
              <CardTitle>Matching Engine</CardTitle>
            </div>
            <CardDescription>
              Choose how Switchy scores jobs and when AI should review ambiguity
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "border-border hover:bg-muted hover:text-foreground",
              unmatchedCount > 0 && !hasProviders && "border-purple-500/30 text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
            )}
            onClick={onMatchUnmatched}
            disabled={isMatching || unmatchedCount === 0 || !hasProviders}
          >
            <Sparkles className={cn("mr-2 h-4 w-4", isMatching && "animate-pulse")} />
            {isMatching 
              ? matchProgress 
                ? `${matchProgress.completed}/${matchProgress.total} matched` 
                : "Matching..."
              : "Match Unmatched"
            }
            {!isMatching && unmatchedCount > 0 && (
              <span className="ml-2 bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded text-xs">
                {unmatchedCount}
              </span>
            )}
            {isMatching && matchProgress && (
              <span className="ml-2 bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded text-xs">
                {matchProgress.succeeded}✓ {matchProgress.failed}✕
              </span>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {hasProviders ? (
          <>
            {/* Primary Settings */}
            <div className="grid gap-6">
              <div className="space-y-3">
                <div>
                  <Label>Matching quality</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Balanced is recommended. Higher quality asks the model to review more ambiguous matches.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {([
                    ["economy", "Economy", "Mostly deterministic; review only very low-confidence matches."],
                    ["balanced", "Balanced", "Review ambiguous mid-range matches while reusing cached evidence."],
                    ["quality", "Quality", "Review a wider score range for maximum nuance."],
                  ] as const).map(([value, label, description]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={qualityPreset === value}
                      onClick={() => onQualityPresetChange(value)}
                      className={cn(
                        "rounded-lg border p-4 text-left transition-colors",
                        qualityPreset === value
                          ? "border-emerald-500/60 bg-emerald-500/10"
                          : "border-border bg-background/30 hover:border-muted-foreground/40"
                      )}
                    >
                      <span className="text-sm font-medium text-foreground">{label}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                        {description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Provider and Model */}
              <div className="space-y-3">
                <Label>AI Provider & Model</Label>
                <div className="flex gap-2">
                  <Select value={matcherProviderId} onValueChange={onMatcherProviderIdChange}>
                    <SelectTrigger className="w-[180px] bg-background/60 border-border">
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
                  <ModelCombobox
                    models={models}
                    value={matcherModel}
                    onValueChange={onMatcherModelChange}
                    disabled={modelsLoading || models.length === 0}
                    loading={modelsLoading}
                    error={modelsError}
                    placeholder="Select model"
                  />
                  {supportsReasoning && (
                    <Select value={matcherReasoningEffort} onValueChange={onMatcherReasoningEffortChange}>
                      <SelectTrigger
                        aria-label="Reasoning effort"
                        className="w-32 bg-background/60 border-border"
                      >
                        <SelectValue placeholder="Effort" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {REASONING_EFFORT_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
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

              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex items-start gap-3 rounded-lg border border-border bg-background/30 p-4">
                  <input
                    type="checkbox"
                    id="auto-match"
                    checked={autoMatchAfterScrape}
                    onChange={(e) => onAutoMatchAfterScrapeChange(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-border bg-muted text-emerald-500 focus:ring-emerald-500 focus:ring-offset-background"
                  />
                  <div>
                    <Label htmlFor="auto-match" className="cursor-pointer font-medium">
                      Auto-match after scrape
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Automatically match new jobs after each scrape.
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-background/30 p-4">
                  <Label>Accepted work arrangements</Label>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {["remote", "hybrid", "onsite"].map((value) => (
                      <label key={value} className="flex items-center gap-2 text-sm capitalize text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={acceptedLocationTypes.includes(value)}
                          onChange={() => toggleValue(
                            acceptedLocationTypes,
                            value,
                            onAcceptedLocationTypesChange
                          )}
                          className="h-4 w-4 rounded border-border bg-muted text-emerald-500"
                        />
                        {value}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background/30 p-4">
                <Label>Accepted employment types</Label>
                <div className="mt-3 flex flex-wrap gap-3">
                  {[
                    ["full-time", "Full time"],
                    ["part-time", "Part time"],
                    ["contract", "Contract"],
                    ["intern", "Internship"],
                    ["temporary", "Temporary"],
                  ].map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={acceptedEmploymentTypes.includes(value)}
                        onChange={() => toggleValue(
                          acceptedEmploymentTypes,
                          value,
                          onAcceptedEmploymentTypesChange
                        )}
                        className="h-4 w-4 rounded border-border bg-muted text-emerald-500"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <Separator className="bg-muted" />

            {/* Advanced Settings */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-base">Advanced</Label>
                  <p className="text-xs text-muted-foreground">
                    Override request limits only when your provider or hardware needs it.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="h-8 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Settings2 className="mr-2 h-3.5 w-3.5" />
                  {showAdvanced ? "Hide advanced" : "Show advanced"}
                </Button>
              </div>

              {showAdvanced && (
                <div className="grid gap-4 rounded-lg border border-border bg-background/30 p-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-2">
                      <Label htmlFor="batch-size" className="text-xs text-muted-foreground">Analysis batch</Label>
                      <Input
                        id="batch-size"
                        type="number"
                        min={1}
                        max={10}
                        value={batchSize}
                        onChange={(e) => onBatchSizeChange(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                        className="bg-background/60 border-border"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="max-retries" className="text-xs text-muted-foreground">Max attempts</Label>
                      <Input
                        id="max-retries"
                        type="number"
                        min={1}
                        max={10}
                        value={maxRetries}
                        onChange={(e) => onMaxRetriesChange(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                        className="bg-background/60 border-border"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="timeout" className="text-xs text-muted-foreground">Timeout (sec)</Label>
                      <Input
                        id="timeout"
                        type="number"
                        min={5}
                        max={120}
                        value={Math.round(timeoutMs / 1000)}
                        onChange={(e) => onTimeoutMsChange(Math.min(120000, Math.max(5000, (parseInt(e.target.value) || 5) * 1000)))}
                        className="bg-background/60 border-border"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="concurrency" className="text-xs text-muted-foreground">Concurrency</Label>
                      <Input
                        id="concurrency"
                        type="number"
                        min={1}
                        max={10}
                        value={concurrencyLimit}
                        onChange={(e) => onConcurrencyLimitChange(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                        className="bg-background/60 border-border"
                      />
                    </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 px-4 rounded-lg border border-dashed border-border bg-background/20">
            <Cpu className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm font-medium">No AI Provider configured</p>
            <p className="text-muted-foreground text-xs mt-1">Add an AI Provider above to use the matching engine</p>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex items-center justify-between border-t border-border bg-card/70 px-6 py-4 rounded-b-xl">
        <p className="text-xs text-muted-foreground">
          {!hasProviders ? (
            "Add a provider to configure matching"
          ) : settingsSaved ? (
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
          disabled={isSaving || !hasUnsavedChanges || !hasProviders || !matcherModel}
          className="bg-emerald-600 hover:bg-emerald-500 text-foreground min-w-[120px]"
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
