import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base-provider";
import type { AIProvider, ModelConfig, ProviderConfig } from "./types";

/**
 * OpenRouter provider implementation
 * Provides access to multiple models through OpenRouter API
 */
export class OpenRouterProvider extends BaseProvider {
  readonly id: AIProvider = "openrouter";
  readonly name = "OpenRouter";
  readonly requiresApiKey = true;

  /**
   * Models that support reasoning effort through OpenRouter
   */
  supportsReasoningEffort(modelId: string): boolean {
    const reasoningModels = [
      "gpt-oss-120b",
      "gemini-3-",
      "gpt-5.2",
      "gpt-5-mini",
    ];
    return reasoningModels.some((model) => modelId.includes(model));
  }

  /**
   * OpenRouter supports reasoning effort for specific models
   */
  getGenerationOptions(
    config: ModelConfig,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _providerConfig: ProviderConfig
  ): Record<string, unknown> | undefined {
    if (!config.reasoningEffort || !this.supportsReasoningEffort(config.modelId)) {
      return undefined;
    }

    return {
      providerOptions: {
        openrouter: {
          reasoningEffort: config.reasoningEffort,
        },
      },
    };
  }

  protected createLanguageModel(
    config: ModelConfig,
    _providerConfig: ProviderConfig
  ): LanguageModel {
    const openrouter = createOpenRouter({
      apiKey: _providerConfig.apiKey,
    });

    return openrouter.chat(config.modelId);
  }
}

/**
 * Singleton instance
 */
export const openrouterProvider = new OpenRouterProvider();
