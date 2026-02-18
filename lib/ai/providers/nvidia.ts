import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base-provider";
import type { AIProvider, ModelConfig, ProviderConfig } from "./types";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

export class NvidiaProvider extends BaseProvider {
  readonly id: AIProvider = "nvidia";
  readonly name = "NVIDIA (NIM)";
  readonly requiresApiKey = true;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  supportsReasoningEffort(_modelId: string): boolean {
    return true;
  }

  protected createLanguageModel(
    config: ModelConfig,
    providerConfig: ProviderConfig
  ): LanguageModel {
    const nvidia = createOpenAICompatible({
      name: "nvidia",
      baseURL: NVIDIA_BASE_URL,
      apiKey: providerConfig.apiKey,
    });

    return nvidia(config.modelId);
  }
}

export const nvidiaProvider = new NvidiaProvider();
