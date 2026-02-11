import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base-provider";
import type { AIProvider, ModelConfig, ProviderConfig } from "./types";

/**
 * OpenAI provider implementation
 */
export class OpenAIProvider extends BaseProvider {
  readonly id: AIProvider = "openai";
  readonly name = "OpenAI";
  readonly requiresApiKey = true;

  /**
   * GPT-5.x models support reasoning effort
   */
  supportsReasoningEffort(modelId: string): boolean {
    return (
      modelId.includes("gpt-5.2") ||
      modelId.includes("gpt-5-mini")
    );
  }

  /**
   * OpenAI supports reasoning effort via providerOptions
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
        openai: {
          reasoningEffort: config.reasoningEffort,
        },
      },
    };
  }

  protected createLanguageModel(
    config: ModelConfig,
    providerConfig: ProviderConfig
  ): LanguageModel {
    const openai = createOpenAI({
      apiKey: providerConfig.apiKey,
    });

    return openai(config.modelId);
  }
}

/**
 * Singleton instance
 */
export const openaiProvider = new OpenAIProvider();
