
export const ANTHROPIC_MODELS = [
  {
    id: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    description: "Most capable model",
  },
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    description: "Balanced performance",
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    description: "Fast and cost effective",
  },
];

export const GEMINI_API_KEY_MODELS = [
  {
    id: "gemini-3-pro-preview",
    label: "Gemini 3 Pro",
    description: "Most capable model (Preview)",
  },
  {
    id: "gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    description: "Fastest model (Preview)",
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    description: "Balanced performance",
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    description: "Cost effective",
  },
];

export const GEMINI_CLI_MODELS = GEMINI_API_KEY_MODELS;

export const OPENAI_MODELS = [
  {
    id: "gpt-5.2",
    label: "GPT-5.2",
    description: "Latest flagship model",
  },
  {
    id: "gpt-5-mini",
    label: "GPT-5 Mini",
    description: "Fast and cost effective",
  },
  {
    id: "gpt-5-nano",
    label: "GPT-5 Nano",
    description: "Lowest latency and cost",
  },
];

export const OPENROUTER_MODELS = [
  {
    id: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    description: "Reasoning-capable model",
  },
  {
    id: "google/gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    description: "Gemini 3 Fastest model (Preview)",
  },
  {
    id: "google/gemini-3-pro-preview",
    label: "Gemini 3 Pro",
    description: "Gemini 3 Most capable model (Preview)",
  },
  {
    id: "openai/gpt-5.2",
    label: "GPT-5.2",
    description: "OpenAI's latest flagship model",
  },
  {
    id: "openai/gpt-5-mini",
    label: "GPT-5 Mini",
    description: "OpenAI's fastest and most cost-effective model",
  },
  {
    id: "openai/gpt-5-nano",
    label: "GPT-5 Nano",
    description: "OpenAI's lowest latency and cost model",
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    label: "Claude Sonnet 4.5",
    description: "Claude's most capable model",
  },
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    description: "Claude's fastest and most cost-effective model",
  },
  {
    id: "anthropic/claude-opus-4.6",
    label: "Claude Opus 4.6",
    description: "Claude's highest quality model",
  },
];

export const CEREBRAS_MODELS = [
  {
    id: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    description: "Reasoning-capable model",
  },
  {
    id: "qwen-3-32b",
    label: "Qwen 3 32B",
    description: "Reasoning-capable model",
  },
  {
    id: "zai-glm-4.7",
    label: "ZAI GLM 4.7",
    description: "Reasoning-capable model",
  },
  {
    id: "llama-3.3-70b",
    label: "Llama 3.3 70B",
    description: "High quality responses",
  },
  {
    id: "llama3.1-8b",
    label: "Llama 3.1 8B",
    description: "Lower latency and cheaper",
  },
];

export type AIProvider =
  | "anthropic"
  | "openai"
  | "gemini_api_key"
  | "gemini_cli_oauth"
  | "openrouter"
  | "cerebras"
  | "google";

export function getModelsForProvider(provider: string) {
  switch (provider) {
    case "gemini_api_key":
    case "gemini_cli_oauth":
    case "google":
      return GEMINI_API_KEY_MODELS;
    case "openai":
      return OPENAI_MODELS;
    case "openrouter":
      return OPENROUTER_MODELS;
    case "cerebras":
      return CEREBRAS_MODELS;
    case "anthropic":
    default:
      return ANTHROPIC_MODELS;
  }
}

export function getDefaultModelForProvider(provider: string) {
  const models = getModelsForProvider(provider);
  const fallback = ANTHROPIC_MODELS[0]?.id || "claude-sonnet-4-5";
  return models[0]?.id || fallback;
}
