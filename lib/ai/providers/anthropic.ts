import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base-provider";
import type { AIProvider, ModelConfig, ProviderConfig } from "./types";

/**
 * Anthropic Claude provider implementation
 */
export class AnthropicProvider extends BaseProvider {
  readonly id: AIProvider = "anthropic";
  readonly name = "Anthropic (Claude)";
  readonly requiresApiKey = true;

  /**
   * Anthropic models currently do not support reasoning effort parameter
   */
  supportsReasoningEffort(_modelId: string): boolean {
    return false;
  }

  protected createLanguageModel(
    config: ModelConfig,
    providerConfig: ProviderConfig
  ): LanguageModel {
    const anthropic = createAnthropic({
      apiKey: providerConfig.apiKey,
    });

    return anthropic(config.modelId);
  }
}

/**
 * Singleton instance
 */
export const anthropicProvider = new AnthropicProvider();
