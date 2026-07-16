import type { AIProvider } from "./types";

export interface ProviderMetadata {
  id: AIProvider;
  displayName: string;
  kind: "api_key" | "local_cli";
  requiresApiKey: boolean;
  apiKeyUrl?: string;
  freeTierNote?: string;
}

export const PROVIDER_METADATA: Record<AIProvider, ProviderMetadata> = {
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic",
    kind: "api_key",
    requiresApiKey: true,
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    freeTierNote: "You may be charged based on your usage and selected model pricing.",
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    kind: "api_key",
    requiresApiKey: true,
    apiKeyUrl: "https://platform.openai.com/api-keys",
    freeTierNote: "You may be charged based on your usage and selected model pricing.",
  },
  gemini_api_key: {
    id: "gemini_api_key",
    displayName: "Google Gemini",
    kind: "api_key",
    requiresApiKey: true,
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    freeTierNote: "Provides free models with rate limits depending on the model tier.",
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    kind: "api_key",
    requiresApiKey: true,
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    freeTierNote: "You may be charged based on your usage and selected model pricing.",
  },
  cerebras: {
    id: "cerebras",
    displayName: "Cerebras",
    kind: "api_key",
    requiresApiKey: true,
    apiKeyUrl: "https://cloud.cerebras.ai/platform/api-keys",
    freeTierNote: "Provides free models with rate limits depending on account tier.",
  },
  groq: {
    id: "groq",
    displayName: "Groq",
    kind: "api_key",
    requiresApiKey: true,
    apiKeyUrl: "https://console.groq.com/keys",
    freeTierNote: "Provides free models with rate limits and quota limits.",
  },
  nvidia: {
    id: "nvidia",
    displayName: "NVIDIA (NIM)",
    kind: "api_key",
    requiresApiKey: true,
    apiKeyUrl: "https://build.nvidia.com/settings/api-keys",
    freeTierNote: "Provides free models with rate limits and usage caps.",
  },
  codex_cli: {
    id: "codex_cli",
    displayName: "Codex CLI",
    kind: "local_cli",
    requiresApiKey: false,
    freeTierNote: "Uses the authentication already configured by the Codex CLI.",
  },
  opencode_cli: {
    id: "opencode_cli",
    displayName: "OpenCode",
    kind: "local_cli",
    requiresApiKey: false,
    freeTierNote: "Uses providers and authentication already configured by OpenCode.",
  },
};

export function getProviderMetadata(provider: AIProvider): ProviderMetadata {
  return PROVIDER_METADATA[provider];
}

export function getAllProviderMetadata(): ProviderMetadata[] {
  return Object.values(PROVIDER_METADATA);
}
