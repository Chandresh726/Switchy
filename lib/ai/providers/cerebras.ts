import { createCerebras } from "@ai-sdk/cerebras";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base-provider";
import type { AIProvider, ModelConfig, ProviderConfig } from "./types";

/**
 * Cerebras provider implementation
 */
export class CerebrasProvider extends BaseProvider {
  readonly id: AIProvider = "cerebras";
  readonly name = "Cerebras";
  readonly requiresApiKey = true;

  /**
   * Cerebras models that support reasoning effort
   */
  supportsReasoningEffort(modelId: string): boolean {
    const reasoningModels = [
      "gpt-oss-120b",
      "qwen-3-32b",
      "zai-glm-4.7",
    ];
    return reasoningModels.some((model) => modelId.includes(model));
  }

  /**
   * Cerebras supports reasoning effort via providerOptions
   */
  getGenerationOptions(
    config: ModelConfig,
    _providerConfig: ProviderConfig
  ): Record<string, unknown> | undefined {
    if (!config.reasoningEffort || !this.supportsReasoningEffort(config.modelId)) {
      return undefined;
    }

    return {
      providerOptions: {
        cerebras: {
          reasoningEffort: config.reasoningEffort,
        },
      },
    };
  }

  protected createLanguageModel(
    config: ModelConfig,
    providerConfig: ProviderConfig
  ): LanguageModel {
    const cerebras = createCerebras({
      apiKey: providerConfig.apiKey,
    });

    return cerebras(config.modelId);
  }
}

/**
 * Singleton instance
 */
export const cerebrasProvider = new CerebrasProvider();
