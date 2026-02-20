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
  apiKeyUrl?: string;
  freeTierNote?: string;
}

export const PROVIDER_METADATA: Record<AIProvider, ProviderMetadata> = {
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic",
    requiresApiKey: true,
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    freeTierNote: "You may be charged based on your usage and selected model pricing.",
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    requiresApiKey: true,
    apiKeyUrl: "https://platform.openai.com/api-keys",
    freeTierNote: "You may be charged based on your usage and selected model pricing.",
  },
  gemini_api_key: {
    id: "gemini_api_key",
    displayName: "Google Gemini",
    requiresApiKey: true,
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    freeTierNote: "Provides free models with rate limits depending on the model tier.",
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    requiresApiKey: true,
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    freeTierNote: "You may be charged based on your usage and selected model pricing.",
  },
  cerebras: {
    id: "cerebras",
    displayName: "Cerebras",
    requiresApiKey: true,
    apiKeyUrl: "https://cloud.cerebras.ai/platform/api-keys",
    freeTierNote: "Provides free models with rate limits depending on account tier.",
  },
  groq: {
    id: "groq",
    displayName: "Groq",
    requiresApiKey: true,
    apiKeyUrl: "https://console.groq.com/keys",
    freeTierNote: "Provides free models with rate limits and quota limits.",
  },
  nvidia: {
    id: "nvidia",
    displayName: "NVIDIA (NIM)",
    requiresApiKey: true,
    apiKeyUrl: "https://build.nvidia.com/settings/api-keys",
    freeTierNote: "Provides free models with rate limits and usage caps.",
  },
};

export function getProviderMetadata(provider: AIProvider): ProviderMetadata {
  return PROVIDER_METADATA[provider];
}

export function getAllProviderMetadata(): ProviderMetadata[] {
  return Object.values(PROVIDER_METADATA);
}
