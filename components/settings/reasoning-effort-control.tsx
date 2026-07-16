"use client";

import { AlertTriangle } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProviderModelOption } from "@/lib/types";

interface ReasoningEffortControlProps {
  model?: ProviderModelOption;
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel?: string;
}

interface ResolveReasoningSelectionOptions {
  localValue?: string;
  savedValue?: string;
  providerWasEdited: boolean;
  model?: ProviderModelOption;
}

function readableLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function hasInvalidReasoningSelection(
  model: ProviderModelOption | undefined,
  value: string
): boolean {
  if (!model || model.reasoningControl.kind !== "effort" || !value) return false;
  return !model.reasoningControl.options.some((option) => option.value === value);
}

export function getModelReasoningDefault(model?: ProviderModelOption): string {
  if (!model || model.reasoningControl.kind === "provider_default") return "";
  return model.reasoningControl.defaultValue ??
    model.reasoningControl.options[0]?.value ??
    "";
}

export function resolveReasoningSelection({
  localValue,
  savedValue,
  providerWasEdited,
  model,
}: ResolveReasoningSelectionOptions): string {
  if (localValue !== undefined) return localValue;
  if (!providerWasEdited) return savedValue || "";
  return getModelReasoningDefault(model);
}

export function ReasoningEffortControl({
  model,
  value,
  onValueChange,
  ariaLabel = "Reasoning effort",
}: ReasoningEffortControlProps) {
  if (!model) {
    if (!value) return null;
    return (
      <span
        className="inline-flex h-9 shrink-0 items-center border border-amber-500/40 bg-amber-500/5 px-3 text-xs text-amber-400"
        title="The saved reasoning value cannot be validated until this model is available"
      >
        {value} (unavailable)
      </span>
    );
  }

  if (model.reasoningControl.kind === "provider_default") {
    return (
      <span
        className="inline-flex h-9 shrink-0 items-center border border-border bg-background/40 px-3 text-xs text-muted-foreground"
        title="This provider does not publish selectable reasoning levels for this model"
      >
        Provider default
      </span>
    );
  }

  const options = model.reasoningControl.options;
  const invalid = hasInvalidReasoningSelection(model, value);

  return (
    <div className="shrink-0 space-y-1">
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger
          aria-label={ariaLabel}
          className="w-36 bg-background/60 border-border"
        >
          <SelectValue placeholder="Effort" />
        </SelectTrigger>
        <SelectContent>
          {invalid && (
            <SelectItem value={value} disabled>
              {value} (unavailable)
            </SelectItem>
          )}
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              title={option.description}
            >
              {option.label || readableLabel(option.value)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {invalid && (
        <p className="flex max-w-52 items-center gap-1 text-[11px] text-amber-400">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Choose an advertised value
        </p>
      )}
    </div>
  );
}
