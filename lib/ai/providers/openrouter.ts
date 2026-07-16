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

  protected createLanguageModel(
    config: ModelConfig,
    _providerConfig: ProviderConfig
  ): LanguageModel {
    const openrouter = createOpenRouter({
      apiKey: _providerConfig.apiKey,
    });

    return openrouter.chat(
      config.modelId,
      config.reasoningEffort
        ? { extraBody: { reasoning: { effort: config.reasoningEffort } } }
        : undefined
    );
  }
}

/**
 * Singleton instance
 */
export const openrouterProvider = new OpenRouterProvider();
