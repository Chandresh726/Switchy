import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base-provider";
import type { AIProvider, ModelConfig, ProviderConfig } from "./types";

/**
 * Anthropic Claude provider implementation
 */
class AnthropicProvider extends BaseProvider {
  readonly id: AIProvider = "anthropic";
  readonly name = "Anthropic (Claude)";
  readonly requiresApiKey = true;

  protected createLanguageModel(
    _config: ModelConfig,
    providerConfig: ProviderConfig
  ): LanguageModel {
    const anthropic = createAnthropic({
      apiKey: providerConfig.apiKey,
    });

    return anthropic(_config.modelId);
  }
}

/**
 * Singleton instance
 */
export const anthropicProvider = new AnthropicProvider();
