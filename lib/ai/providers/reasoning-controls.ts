import { isReasoningEffort } from "./types";

const MAX_REASONING_LABEL_LENGTH = 120;
const MAX_REASONING_DESCRIPTION_LENGTH = 500;

function boundDisplayText(value: string | undefined, maxLength: number): string | undefined {
  return value === undefined ? undefined : value.slice(0, maxLength);
}

export interface ProviderReasoningOption {
  value: string;
  label?: string;
  description?: string;
}

export type ProviderReasoningControl =
  | {
      kind: "effort";
      options: ProviderReasoningOption[];
      defaultValue?: string;
    }
  | { kind: "provider_default" };

export function createEffortReasoningControl(
  options: ProviderReasoningOption[],
  defaultValue?: string
): ProviderReasoningControl {
  const seen = new Set<string>();
  const safeOptions = options.flatMap((option) => {
    if (!isReasoningEffort(option.value) || seen.has(option.value)) return [];
    seen.add(option.value);
    return [{
      value: option.value,
      ...(option.label !== undefined
        ? { label: boundDisplayText(option.label, MAX_REASONING_LABEL_LENGTH) }
        : {}),
      ...(option.description !== undefined
        ? { description: boundDisplayText(option.description, MAX_REASONING_DESCRIPTION_LENGTH) }
        : {}),
    }];
  });

  if (safeOptions.length === 0) return { kind: "provider_default" };
  const safeDefault = defaultValue && safeOptions.some(({ value }) => value === defaultValue)
    ? defaultValue
    : undefined;
  return {
    kind: "effort",
    options: safeOptions,
    ...(safeDefault ? { defaultValue: safeDefault } : {}),
  };
}

export function withReasoningControl<T extends object>(
  model: T,
  reasoningControl: ProviderReasoningControl,
  supportsReasoning = reasoningControl.kind === "effort"
): T & {
  supportsReasoning: boolean;
  reasoningControl: ProviderReasoningControl;
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string;
} {
  if (reasoningControl.kind === "provider_default") {
    return { ...model, reasoningControl, supportsReasoning };
  }

  return {
    ...model,
    reasoningControl,
    supportsReasoning: true,
    supportedReasoningEfforts: reasoningControl.options.map(({ value }) => value),
    ...(reasoningControl.defaultValue
      ? { defaultReasoningEffort: reasoningControl.defaultValue }
      : {}),
  };
}
