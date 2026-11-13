"use client";

import { AlertTriangle } from "lucide-react";

import { ModelCombobox } from "@/components/settings/model-combobox";
import {
  hasInvalidReasoningSelection,
  ReasoningEffortControl,
} from "@/components/settings/reasoning-effort-control";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProviderModelOption } from "@/lib/api/contracts/settings";
import type { ReasoningEffort } from "@/lib/settings/types";
import type { Provider } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ProviderModelFieldsProps {
  variant: "analysis" | "final" | "writing" | "resume";
  providers: Provider[];
  providerId: string;
  onProviderChange: (value: string) => void;
  models: ProviderModelOption[];
  loading: boolean;
  error?: string;
  stale: boolean;
  modelId: string;
  onModelChange: (value: string) => void;
  reasoningEffort: ReasoningEffort;
  onReasoningChange: (value: ReasoningEffort) => void;
}

export const ProviderModelFields = ({
  variant,
  providers,
  providerId,
  onProviderChange,
  models,
  loading,
  error,
  stale,
  modelId,
  onModelChange,
  reasoningEffort,
  onReasoningChange,
}: ProviderModelFieldsProps) => {
  const selectedModel = models.find((model) => model.modelId === modelId);
  const unavailable = Boolean(modelId) && !selectedModel;
  const analysis = variant === "analysis";
  const stacked = variant === "resume";
  const warnings = [
    error,
    unavailable
      ? analysis
        ? "The configured analysis model is unavailable. Choose an available model or refresh the catalog."
        : `The configured model is unavailable. Choose ${variant === "final" ? "an available" : "another"} model or refresh the catalog.`
      : undefined,
    stale && !error
      ? analysis
        ? "Showing cached analysis models (latest refresh failed)"
        : "Showing cached model list (latest refresh failed)"
      : undefined,
  ].filter((message): message is string => Boolean(message));
  const providerSelect = (
    <Select value={providerId} onValueChange={onProviderChange}>
      <SelectTrigger
        className={cn(
          "bg-background/60 border-border",
          stacked ? "w-full" : "w-[180px]",
        )}
      >
        <SelectValue placeholder="Select provider" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {providers.map((provider) => (
            <SelectItem key={provider.id} value={provider.id}>
              {provider.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
  const modelControls = (
    <>
      <ModelCombobox
        models={models}
        value={modelId}
        onValueChange={onModelChange}
        disabled={loading || models.length === 0}
        loading={loading}
        error={error}
        placeholder={analysis ? "Select analysis model" : "Select model"}
      />
      <ReasoningEffortControl
        model={selectedModel}
        value={reasoningEffort}
        onValueChange={onReasoningChange}
        ariaLabel={
          analysis
            ? "Job analysis reasoning effort"
            : variant === "final"
              ? "Final match reasoning effort"
              : undefined
        }
      />
    </>
  );
  const warningContent = (
    <>
      {(analysis ? warnings.slice(0, 1) : warnings).map((message) => (
        <p
          key={message}
          className="text-xs text-amber-400 flex items-center gap-2"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          {message}
        </p>
      ))}
      {variant === "writing" &&
        hasInvalidReasoningSelection(selectedModel, reasoningEffort) && (
          <p className="text-xs text-destructive flex items-center gap-2">
            <AlertTriangle />
            Choose a reasoning value advertised by this model.
          </p>
        )}
    </>
  );
  return stacked ? (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>AI Provider</Label>
        {providerSelect}
      </div>
      <div className="space-y-2">
        <Label>Model</Label>
        <div className="flex gap-2">{modelControls}</div>
        {warningContent}
      </div>
    </div>
  ) : (
    <>
      <div className={cn("flex gap-2", variant !== "writing" && "flex-wrap")}>
        {providerSelect}
        {modelControls}
      </div>
      {warningContent}
    </>
  );
};
