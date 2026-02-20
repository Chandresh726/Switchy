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
    const reasoningModels = ["gpt-oss-120b"];
    return reasoningModels.some((model) => modelId.includes(model));
  }

  /**
   * Cerebras supports reasoning effort via providerOptions
   */
  getGenerationOptions(
    config: ModelConfig,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _providerConfig: ProviderConfig
  ): Record<string, unknown> | undefined {
    return this.buildProviderReasoningOptions("cerebras", config);
  }

  protected createLanguageModel(
    config: ModelConfig,
    _providerConfig: ProviderConfig
  ): LanguageModel {
    const cerebras = createCerebras({
      apiKey: _providerConfig.apiKey,
    });

    return cerebras(config.modelId);
  }
}

/**
 * Singleton instance
 */
export const cerebrasProvider = new CerebrasProvider();
