"use client";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Cpu, Settings2, Save, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { AIProvider, getModelsForProvider, modelSupportsReasoning, REASONING_EFFORT_OPTIONS, ReasoningEffort } from "./constants";
import { useState } from "react";

interface MatcherSectionProps {
  matcherModel: string;
  onMatcherModelChange: (value: string) => void;
  matcherReasoningEffort: ReasoningEffort;
  onMatcherReasoningEffortChange: (value: ReasoningEffort) => void;
  aiProvider: AIProvider;
  autoMatchAfterScrape: boolean;
  onAutoMatchAfterScrapeChange: (value: boolean) => void;
  bulkEnabled: boolean;
  onBulkEnabledChange: (value: boolean) => void;
  batchSize: number;
  onBatchSizeChange: (value: number) => void;
  maxRetries: number;
  onMaxRetriesChange: (value: number) => void;
  concurrencyLimit: number;
  onConcurrencyLimitChange: (value: number) => void;
  timeoutMs: number;
  onTimeoutMsChange: (value: number) => void;
  circuitBreakerThreshold: number;
  onCircuitBreakerThresholdChange: (value: number) => void;
  onSave: () => void;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  settingsSaved: boolean;
  onMatchUnmatched: () => void;
  isMatching: boolean;
  unmatchedCount: number;
}

export function MatcherSection({
  matcherModel,
  onMatcherModelChange,
  matcherReasoningEffort,
  onMatcherReasoningEffortChange,
  aiProvider,
  autoMatchAfterScrape,
  onAutoMatchAfterScrapeChange,
  bulkEnabled,
  onBulkEnabledChange,
  batchSize,
  onBatchSizeChange,
  maxRetries,
  onMaxRetriesChange,
  concurrencyLimit,
  onConcurrencyLimitChange,
  timeoutMs,
  onTimeoutMsChange,
  circuitBreakerThreshold,
  onCircuitBreakerThresholdChange,
  onSave,
  isSaving,
  hasUnsavedChanges,
  settingsSaved,
  onMatchUnmatched,
  isMatching,
  unmatchedCount,
}: MatcherSectionProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const supportsReasoning = modelSupportsReasoning(matcherModel, aiProvider);

  return (
    <Card className="border-zinc-800 bg-zinc-900/50 rounded-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-emerald-500" />
              <CardTitle>Matching Engine</CardTitle>
            </div>
            <CardDescription>
              Configure AI models and processing parameters for job matching
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "border-zinc-700 hover:bg-zinc-800 hover:text-white",
              unmatchedCount > 0 && "border-purple-500/30 text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
            )}
            onClick={onMatchUnmatched}
            disabled={isMatching || unmatchedCount === 0}
          >
            <Sparkles className={cn("mr-2 h-4 w-4", isMatching && "animate-pulse")} />
            {isMatching ? "Matching..." : "Match Unmatched"}
            {unmatchedCount > 0 && (
              <span className="ml-2 bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded text-xs">
                {unmatchedCount}
              </span>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Primary Settings */}
        <div className="grid gap-6">
          <div className="space-y-3">
            <Label htmlFor="model-select">AI Model</Label>
            <div className="flex gap-2">
              <Select value={matcherModel} onValueChange={onMatcherModelChange}>
                <SelectTrigger id="model-select" className="flex-1 bg-zinc-950/50 border-zinc-800">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {getModelsForProvider(aiProvider).map((model) => (
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
                <Select value={matcherReasoningEffort} onValueChange={onMatcherReasoningEffortChange}>
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
              The specific model version to use for inference.
              {supportsReasoning && " Reasoning effort controls the depth of AI analysis."}
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/30 p-4">
            <input
              type="checkbox"
              id="auto-match"
              checked={autoMatchAfterScrape}
              onChange={(e) => onAutoMatchAfterScrapeChange(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
            />
            <div>
              <Label htmlFor="auto-match" className="cursor-pointer font-medium">
                Auto-match after scrape
              </Label>
              <p className="text-xs text-zinc-500 mt-1">
                Automatically trigger the matching process immediately after discovering new jobs.
              </p>
            </div>
          </div>
        </div>

        <Separator className="bg-zinc-800" />

        {/* Performance Settings */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base">Performance & Limits</Label>
              <p className="text-xs text-zinc-500">
                Fine-tune API usage and concurrency
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="h-8 text-xs text-zinc-400 hover:text-white"
            >
              <Settings2 className="mr-2 h-3.5 w-3.5" />
              {showAdvanced ? "Simple View" : "Advanced View"}
            </Button>
          </div>

          <div className="grid gap-6">
            <div className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/30 p-4">
              <input
                type="checkbox"
                id="bulk-enabled"
                checked={bulkEnabled}
                onChange={(e) => onBulkEnabledChange(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
              />
              <div>
                <Label htmlFor="bulk-enabled" className="cursor-pointer font-medium">
                  Bulk Matching
                </Label>
                <p className="text-xs text-zinc-500 mt-1">
                  Process multiple jobs in a single API call to save time and reduce requests.
                </p>
              </div>
            </div>

            {(showAdvanced || bulkEnabled) && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className={cn("space-y-2", !bulkEnabled && "opacity-50 grayscale")}>
                  <Label htmlFor="batch-size" className="text-xs text-zinc-400">Batch Size</Label>
                  <Input
                    id="batch-size"
                    type="number"
                    min={1}
                    max={10}
                    value={batchSize}
                    onChange={(e) => onBatchSizeChange(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="bg-zinc-950/50 border-zinc-800"
                    disabled={!bulkEnabled}
                  />
                </div>

                {showAdvanced && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="max-retries" className="text-xs text-zinc-400">Max Retries</Label>
                      <Input
                        id="max-retries"
                        type="number"
                        min={1}
                        max={5}
                        value={maxRetries}
                        onChange={(e) => onMaxRetriesChange(Math.min(5, Math.max(1, parseInt(e.target.value) || 1)))}
                        className="bg-zinc-950/50 border-zinc-800"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="timeout" className="text-xs text-zinc-400">Timeout (sec)</Label>
                      <Input
                        id="timeout"
                        type="number"
                        min={5}
                        max={120}
                        value={Math.round(timeoutMs / 1000)}
                        onChange={(e) => onTimeoutMsChange(Math.min(120000, Math.max(5000, (parseInt(e.target.value) || 5) * 1000)))}
                        className="bg-zinc-950/50 border-zinc-800"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="concurrency" className="text-xs text-zinc-400">Concurrency</Label>
                      <Input
                        id="concurrency"
                        type="number"
                        min={1}
                        max={10}
                        value={aiProvider === "modal" ? 1 : concurrencyLimit}
                        onChange={(e) => onConcurrencyLimitChange(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                        className="bg-zinc-950/50 border-zinc-800"
                        disabled={aiProvider === "modal"}
                      />
                      {aiProvider === "modal" && (
                        <p className="text-xs text-amber-400/80">Locked to 1 for Modal (rate limit)</p>
                      )}
                    </div>
                    <div className="space-y-2 md:col-span-2 lg:col-span-1">
                      <Label htmlFor="circuit-breaker" className="text-xs text-zinc-400">Circuit Breaker</Label>
                      <Input
                        id="circuit-breaker"
                        type="number"
                        min={3}
                        max={50}
                        value={circuitBreakerThreshold}
                        onChange={(e) => onCircuitBreakerThresholdChange(Math.min(50, Math.max(3, parseInt(e.target.value) || 10)))}
                        className="bg-zinc-950/50 border-zinc-800"
                      />
                    </div>
                  </>
                )}
              </div>
            )}
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
