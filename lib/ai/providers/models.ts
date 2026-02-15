import type { AIProvider } from "./types";

export interface ModelDefinition {
  modelId: string;
  label: string;
  description: string;
  supportsReasoning: boolean;
}

export const PROVIDER_MODELS: Record<AIProvider, ModelDefinition[]> = {
  anthropic: [
    {
      modelId: "claude-opus-4-6",
      label: "Claude Opus 4.6",
      description: "Most capable model",
      supportsReasoning: true,
    },
    {
      modelId: "claude-sonnet-4-5",
      label: "Claude Sonnet 4.5",
      description: "Balanced performance",
      supportsReasoning: true,
    },
    {
      modelId: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      description: "Fast and cost effective",
      supportsReasoning: true,
    },
  ],
  openai: [
    {
      modelId: "gpt-5.2",
      label: "GPT-5.2",
      description: "Latest flagship model",
      supportsReasoning: true,
    },
    {
      modelId: "gpt-5-mini",
      label: "GPT-5 Mini",
      description: "Fast and cost effective",
      supportsReasoning: true,
    },
    {
      modelId: "gpt-5-nano",
      label: "GPT-5 Nano",
      description: "Lowest latency and cost",
      supportsReasoning: false,
    },
  ],
  gemini_api_key: [
    {
      modelId: "gemini-3-pro-preview",
      label: "Gemini 3 Pro",
      description: "Most capable model (Preview)",
      supportsReasoning: true,
    },
    {
      modelId: "gemini-3-flash-preview",
      label: "Gemini 3 Flash",
      description: "Fastest model (Preview)",
      supportsReasoning: true,
    },
  ],
  gemini_cli_oauth: [
    {
      modelId: "gemini-3-pro-preview",
      label: "Gemini 3 Pro",
      description: "Most capable model (Preview)",
      supportsReasoning: true,
    },
    {
      modelId: "gemini-3-flash-preview",
      label: "Gemini 3 Flash",
      description: "Fastest model (Preview)",
      supportsReasoning: true,
    },
  ],
  google: [
    {
      modelId: "gemini-3-pro-preview",
      label: "Gemini 3 Pro",
      description: "Most capable model (Preview)",
      supportsReasoning: true,
    },
    {
      modelId: "gemini-3-flash-preview",
      label: "Gemini 3 Flash",
      description: "Fastest model (Preview)",
      supportsReasoning: true,
    },
  ],
  openrouter: [
    {
      modelId: "openai/gpt-oss-120b:free",
      label: "GPT-OSS 120B (Free)",
      description: "Reasoning-capable model (Free tier)",
      supportsReasoning: false,
    },
    {
      modelId: "deepseek/deepseek-r1-0528:free",
      label: "DeepSeek R1",
      description: "DeepSeek's reasoning model (Free tier)",
      supportsReasoning: true,
    },
    {
      modelId: "z-ai/glm-4.5-air:free",
      label: "GLM-4.5 Air",
      description: "Z-AI's GLM-4.5 Air model (Free tier)",
      supportsReasoning: true,
    },
    {
      modelId: "arcee-ai/trinity-large-preview:free",
      label: "Trinity Large Preview",
      description: "Arcee AI's Trinity Large model (Free tier)",
      supportsReasoning: false,
    },
    {
      modelId: "gpt-oss-120b",
      label: "GPT-OSS 120B",
      description: "Reasoning-capable model",
      supportsReasoning: true,
    },
    {
      modelId: "google/gemini-3-flash-preview",
      label: "Gemini 3 Flash",
      description: "Gemini 3 Fastest model (Preview)",
      supportsReasoning: true,
    },
    {
      modelId: "openai/gpt-5.2",
      label: "GPT-5.2",
      description: "OpenAI's latest flagship model",
      supportsReasoning: true,
    },
    {
      modelId: "openai/gpt-5-mini",
      label: "GPT-5 Mini",
      description: "OpenAI's fastest and most cost-effective model",
      supportsReasoning: true,
    },
    {
      modelId: "openai/gpt-5-nano",
      label: "GPT-5 Nano",
      description: "OpenAI's lowest latency and cost model",
      supportsReasoning: false,
    },
    {
      modelId: "anthropic/claude-sonnet-4.5",
      label: "Claude Sonnet 4.5",
      description: "Claude's most capable model",
      supportsReasoning: false,
    },
    {
      modelId: "anthropic/claude-haiku-4.5",
      label: "Claude Haiku 4.5",
      description: "Claude's fastest and most cost-effective model",
      supportsReasoning: false,
    },
    {
      modelId: "anthropic/claude-opus-4.6",
      label: "Claude Opus 4.6",
      description: "Claude's highest quality model",
      supportsReasoning: false,
    },
  ],
  cerebras: [
    {
      modelId: "gpt-oss-120b",
      label: "GPT-OSS 120B",
      description: "Reasoning-capable model",
      supportsReasoning: true,
    },
    {
      modelId: "qwen-3-235b-a22b-instruct-2507",
      label: "Qwen 3 235B A22B Instruct",
      description: "Reasoning-capable preview model",
      supportsReasoning: true,
    },
    {
      modelId: "zai-glm-4.7",
      label: "ZAI GLM 4.7",
      description: "Reasoning-capable model",
      supportsReasoning: true,
    },
    {
      modelId: "llama3.1-8b",
      label: "Llama 3.1 8B",
      description: "Lower latency and cheaper",
      supportsReasoning: false,
    },
  ],
  modal: [
    {
      modelId: "zai-org/GLM-5-FP8",
      label: "GLM-5 FP8",
      description: "Frontier open model via Modal",
      supportsReasoning: true,
    },
  ],
};

export function getModelsForProvider(provider: AIProvider): ModelDefinition[] {
  return PROVIDER_MODELS[provider] || [];
}

export function getDefaultModelForProvider(provider: AIProvider): string {
  const models = getModelsForProvider(provider);
  return models[0]?.modelId || "claude-sonnet-4-5";
}

export function modelSupportsReasoning(provider: AIProvider, modelId: string): boolean {
  const models = getModelsForProvider(provider);
  return models.find((m) => m.modelId === modelId)?.supportsReasoning || false;
}

export function getAllModelsFlat(): Array<{
  provider: AIProvider;
  model: ModelDefinition;
}> {
  const result: Array<{ provider: AIProvider; model: ModelDefinition }> = [];
  for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
    for (const model of models) {
      result.push({ provider: provider as AIProvider, model });
    }
  }
  return result;
}
