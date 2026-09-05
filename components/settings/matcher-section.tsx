"use client";

import { useState } from "react";

import { AlertTriangle, Cpu, Loader2, Settings2, Sparkles } from "lucide-react";

import { ModelCombobox } from "@/components/settings/model-combobox";
import { ReasoningEffortControl } from "@/components/settings/reasoning-effort-control";
import { MatchPipelineProgress } from "@/components/matching/match-pipeline-progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { ReasoningEffort } from "@/lib/settings/types";
import type { MatchSessionProgress } from "@/lib/api/contracts/runtime";
import type { ProviderModelOption } from "@/lib/api/contracts/settings";
import type { Provider } from "@/lib/types";

export interface MatcherSectionProps {
  availableProviders: Provider[];
  hasProviders: boolean;
  jobAnalysisModels: ProviderModelOption[];
  jobAnalysisModelsLoading: boolean;
  jobAnalysisModelsError?: string;
  jobAnalysisModelsStale: boolean;
  jobAnalysisProviderId: string;
  onJobAnalysisProviderIdChange: (value: string) => void;
  jobAnalysisModel: string;
  onJobAnalysisModelChange: (value: string) => void;
  jobAnalysisReasoningEffort: ReasoningEffort;
  onJobAnalysisReasoningEffortChange: (value: ReasoningEffort) => void;
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
  onMatchUnmatched: (days: number) => void;
  isMatching: boolean;
  matchProgress?: MatchSessionProgress;
  unmatchedWindowDays: number;
  onUnmatchedWindowDaysChange: (days: number) => void;
  onUnmatchedWindowOpen: () => void;
  unmatchedCount: number;
  unmatchedCountLoading: boolean;
}

export function MatcherSection({
  availableProviders,
  hasProviders,
  jobAnalysisModels,
  jobAnalysisModelsLoading,
  jobAnalysisModelsError,
  jobAnalysisModelsStale,
  jobAnalysisProviderId,
  onJobAnalysisProviderIdChange,
  jobAnalysisModel,
  onJobAnalysisModelChange,
  jobAnalysisReasoningEffort,
  onJobAnalysisReasoningEffortChange,
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
  onMatchUnmatched,
  isMatching,
  matchProgress,
  unmatchedWindowDays,
  onUnmatchedWindowDaysChange,
  onUnmatchedWindowOpen,
  unmatchedCount,
  unmatchedCountLoading,
}: MatcherSectionProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [daysInput, setDaysInput] = useState(String(unmatchedWindowDays));
  const parsedDays = Number(daysInput);
  const validDays = Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 365;
  const selectedAnalysisModel = jobAnalysisModels.find(
    (model) => model.modelId === jobAnalysisModel
  );
  const configuredAnalysisModelUnavailable = Boolean(jobAnalysisModel) && !selectedAnalysisModel;
  const selectedModel = models.find((model) => model.modelId === matcherModel);
  const configuredModelUnavailable = Boolean(matcherModel) && !selectedModel;
  const handleMatchDialogOpenChange = (open: boolean) => {
    setMatchDialogOpen(open);
    if (open) {
      setDaysInput(String(unmatchedWindowDays));
      onUnmatchedWindowOpen();
    }
  };
  const handleDaysInputChange = (value: string) => {
    setDaysInput(value);
    const days = Number(value);
    if (Number.isInteger(days) && days >= 1 && days <= 365) {
      onUnmatchedWindowDaysChange(days);
    }
  };
  const handleMatchConfirmation = () => {
    if (!validDays || unmatchedCountLoading || unmatchedCount === 0) return;
    onMatchUnmatched(parsedDays);
    setMatchDialogOpen(false);
  };

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
              A local candidate snapshot, reusable AI job analysis, and an AI-decided final match.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-border hover:bg-muted hover:text-foreground"
            onClick={() => handleMatchDialogOpenChange(true)}
            disabled={isMatching || !hasProviders}
          >
            <Sparkles data-icon="inline-start" className={cn(isMatching && "animate-pulse")} />
            {isMatching
              ? matchProgress
                ? `${matchProgress.completed}/${matchProgress.total} matched`
                : "Matching..."
              : "Match Unmatched"}
            {isMatching && matchProgress ? (
              <span className="text-xs text-muted-foreground">
                {matchProgress.succeeded}✓ {matchProgress.failed}✕
              </span>
            ) : null}
          </Button>
        </div>
      </CardHeader>
      <Dialog open={matchDialogOpen} onOpenChange={handleMatchDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Match recent unmatched jobs</DialogTitle>
            <DialogDescription>
              Choose how recently jobs were found. Only unmatched jobs inside this window will be queued.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!validDays}>
              <FieldLabel htmlFor="unmatched-window-days">Jobs found within</FieldLabel>
              <Input
                id="unmatched-window-days"
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                value={daysInput}
                onChange={(event) => handleDaysInputChange(event.target.value)}
                aria-invalid={!validDays}
              />
              <FieldDescription>Enter a value from 1 to 365 days.</FieldDescription>
            </Field>
          </FieldGroup>
          <div aria-live="polite" className="flex min-h-10 items-center justify-between border-y border-border py-3">
            <span className="text-sm text-muted-foreground">Unmatched jobs found</span>
            {unmatchedCountLoading || (validDays && parsedDays !== unmatchedWindowDays) ? (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="animate-spin" />
                Checking
              </span>
            ) : (
              <span className="text-lg font-semibold tabular-nums">{validDays ? unmatchedCount : "—"}</span>
            )}
          </div>
          <DialogFooter>
            <Button
              className="w-full"
              onClick={handleMatchConfirmation}
              disabled={
                !validDays ||
                unmatchedCountLoading ||
                parsedDays !== unmatchedWindowDays ||
                unmatchedCount === 0
              }
            >
              <Sparkles data-icon="inline-start" />
              {unmatchedCount === 1 ? "Match 1 job" : `Match ${unmatchedCount} jobs`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CardContent className="space-y-4">
        {isMatching && matchProgress ? (
          <MatchPipelineProgress
            analysis={matchProgress.analysis}
            matching={matchProgress.matching}
            jobs={matchProgress.jobs}
            totalJobs={matchProgress.jobPagination.total}
            compact
          />
        ) : null}
        {hasProviders ? (
          <>
            <div className="grid gap-4">
              <div className="space-y-3 rounded-lg border border-border bg-background/30 p-4">
                <div>
                  <Label>Job Analysis</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Creates a concise role summary and reusable, source-grounded requirements.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select value={jobAnalysisProviderId} onValueChange={onJobAnalysisProviderIdChange}>
                    <SelectTrigger className="w-[180px] bg-background/60 border-border">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {availableProviders.map((provider) => (
                          <SelectItem key={provider.id} value={provider.id}>
                            {provider.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <ModelCombobox
                    models={jobAnalysisModels}
                    value={jobAnalysisModel}
                    onValueChange={onJobAnalysisModelChange}
                    disabled={jobAnalysisModelsLoading || jobAnalysisModels.length === 0}
                    loading={jobAnalysisModelsLoading}
                    error={jobAnalysisModelsError}
                    placeholder="Select analysis model"
                  />
                  <ReasoningEffortControl
                    model={selectedAnalysisModel}
                    value={jobAnalysisReasoningEffort}
                    onValueChange={onJobAnalysisReasoningEffortChange}
                    ariaLabel="Job analysis reasoning effort"
                  />
                </div>
                {(jobAnalysisModelsError || configuredAnalysisModelUnavailable ||
                  (jobAnalysisModelsStale && !jobAnalysisModelsError)) && (
                  <p className="flex items-center gap-2 text-xs text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {jobAnalysisModelsError ?? (configuredAnalysisModelUnavailable
                      ? "The configured analysis model is unavailable. Choose an available model or refresh the catalog."
                      : "Showing cached analysis models (latest refresh failed)")}
                  </p>
                )}
              </div>

              <div className="space-y-3 rounded-lg border border-border bg-background/30 p-4">
                <div>
                  <Label>Final Match</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Scores the final match with a confidence level and evidence-linked reasoning.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select value={matcherProviderId} onValueChange={onMatcherProviderIdChange}>
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
                    value={matcherModel}
                    onValueChange={onMatcherModelChange}
                    disabled={modelsLoading || models.length === 0}
                    loading={modelsLoading}
                    error={modelsError}
                    placeholder="Select model"
                  />
                  <ReasoningEffortControl
                    model={selectedModel}
                    value={matcherReasoningEffort}
                    onValueChange={onMatcherReasoningEffortChange}
                    ariaLabel="Final match reasoning effort"
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
                    The configured model is unavailable. Choose an available model or refresh the catalog.
                  </p>
                )}
                {modelsStale && !modelsError && (
                  <p className="text-xs text-amber-400 flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Showing cached model list (latest refresh failed)
                  </p>
                )}
              </div>

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
                        max={3}
                        value={maxRetries}
                        onChange={(e) => onMaxRetriesChange(Math.min(3, Math.max(1, parseInt(e.target.value) || 1)))}
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
    </Card>
  );
}
