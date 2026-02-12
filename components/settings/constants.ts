
export const ANTHROPIC_MODELS = [
  {
    id: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    description: "Most capable model",
    supportsReasoning: true,
  },
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    description: "Balanced performance",
    supportsReasoning: true,
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    description: "Fast and cost effective",
    supportsReasoning: true,
  },
];

export const GEMINI_API_KEY_MODELS = [
  {
    id: "gemini-3-pro-preview",
    label: "Gemini 3 Pro",
    description: "Most capable model (Preview)",
    supportsReasoning: true,
  },
  {
    id: "gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    description: "Fastest model (Preview)",
    supportsReasoning: true,
  },
];

export const GEMINI_CLI_MODELS = GEMINI_API_KEY_MODELS;

export const OPENAI_MODELS = [
  {
    id: "gpt-5.2",
    label: "GPT-5.2",
    description: "Latest flagship model",
    supportsReasoning: true,
  },
  {
    id: "gpt-5-mini",
    label: "GPT-5 Mini",
    description: "Fast and cost effective",
    supportsReasoning: true,
  },
  {
    id: "gpt-5-nano",
    label: "GPT-5 Nano",
    description: "Lowest latency and cost",
    supportsReasoning: false,
  },
];

export const OPENROUTER_MODELS = [
  {
    id: "openai/gpt-oss-120b:free",
    label: "GPT-OSS 120B (Free)",
    description: "Reasoning-capable model (Free tier)",
    supportsReasoning: false,
  },
  {
    id: "deepseek/deepseek-r1-0528:free",
    label: "DeepSeek R1",
    description: "DeepSeek's reasoning model (Free tier)",
    supportsReasoning: true,
  },
  {
    id: "z-ai/glm-4.5-air:free",
    label: "GLM-4.5 Air",
    description: "Z-AI's GLM-4.5 Air model (Free tier)",
    supportsReasoning: true,
  },
  {
    id: "arcee-ai/trinity-large-preview:free",
    label: "Trinity Large Preview",
    description: "Arcee AI's Trinity Large model (Free tier)",
    supportsReasoning: false,
  },
  {
    id: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    description: "Reasoning-capable model",
    supportsReasoning: true,
  },
  {
    id: "google/gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    description: "Gemini 3 Fastest model (Preview)",
    supportsReasoning: true,
  },
  {
    id: "openai/gpt-5.2",
    label: "GPT-5.2",
    description: "OpenAI's latest flagship model",
    supportsReasoning: true,
  },
  {
    id: "openai/gpt-5-mini",
    label: "GPT-5 Mini",
    description: "OpenAI's fastest and most cost-effective model",
    supportsReasoning: true,
  },
  {
    id: "openai/gpt-5-nano",
    label: "GPT-5 Nano",
    description: "OpenAI's lowest latency and cost model",
    supportsReasoning: false,
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    label: "Claude Sonnet 4.5",
    description: "Claude's most capable model",
    supportsReasoning: false,
  },
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    description: "Claude's fastest and most cost-effective model",
    supportsReasoning: false,
  },
  {
    id: "anthropic/claude-opus-4.6",
    label: "Claude Opus 4.6",
    description: "Claude's highest quality model",
    supportsReasoning: false,
  },
];

export const CEREBRAS_MODELS = [
  {
    id: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    description: "Reasoning-capable model",
    supportsReasoning: true,
  },
  {
    id: "qwen-3-235b-a22b-instruct-2507",
    label: "Qwen 3 235B A22B Instruct",
    description: "Reasoning-capable preview model",
    supportsReasoning: true,
  },
  {
    id: "zai-glm-4.7",
    label: "ZAI GLM 4.7",
    description: "Reasoning-capable model",
    supportsReasoning: true,
  },
  {
    id: "llama3.1-8b",
    label: "Llama 3.1 8B",
    description: "Lower latency and cheaper",
    supportsReasoning: false,
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

export type ReasoningEffort = "low" | "medium" | "high";

export const REASONING_EFFORT_OPTIONS = [
  { value: "low" as ReasoningEffort, label: "Low", description: "Faster processing, less thorough" },
  { value: "medium" as ReasoningEffort, label: "Medium", description: "Balanced approach" },
  { value: "high" as ReasoningEffort, label: "High", description: "Maximum reasoning, slower" },
];

export interface ModelConfig {
  id: string;
  label: string;
  description: string;
  supportsReasoning: boolean;
}

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

export function modelSupportsReasoning(modelId: string, provider: string): boolean {
  const models = getModelsForProvider(provider);
  const model = models.find(m => m.id === modelId);
  return model?.supportsReasoning || false;
}

export function getDefaultReasoningEffort(): ReasoningEffort {
  return "medium";
}
