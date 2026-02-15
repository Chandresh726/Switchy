import type { AIProvider, ReasoningEffort } from "./types";

export interface ReasoningEffortOption {
  value: ReasoningEffort;
  label: string;
  description: string;
}

export const REASONING_EFFORT_OPTIONS: ReasoningEffortOption[] = [
  { value: "low", label: "Low", description: "Faster processing, less thorough" },
  { value: "medium", label: "Medium", description: "Balanced approach" },
  { value: "high", label: "High", description: "Maximum reasoning, slower" },
];

export interface ProviderMetadata {
  id: AIProvider;
  displayName: string;
  requiresApiKey: boolean;
}

export const PROVIDER_METADATA: Record<AIProvider, ProviderMetadata> = {
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic",
    requiresApiKey: true,
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    requiresApiKey: true,
  },
  gemini_api_key: {
    id: "gemini_api_key",
    displayName: "Gemini (API Key)",
    requiresApiKey: true,
  },
  gemini_cli_oauth: {
    id: "gemini_cli_oauth",
    displayName: "Gemini (CLI)",
    requiresApiKey: false,
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    requiresApiKey: true,
  },
  cerebras: {
    id: "cerebras",
    displayName: "Cerebras",
    requiresApiKey: true,
  },
  modal: {
    id: "modal",
    displayName: "Modal",
    requiresApiKey: true,
  },
};

export function getProviderMetadata(provider: AIProvider): ProviderMetadata {
  return PROVIDER_METADATA[provider];
}

export function getAllProviderMetadata(): ProviderMetadata[] {
  return Object.values(PROVIDER_METADATA);
}
