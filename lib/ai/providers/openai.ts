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

  protected createLanguageModel(
    config: ModelConfig,
    _providerConfig: ProviderConfig
  ): LanguageModel {
    const openai = createOpenAI({
      apiKey: _providerConfig.apiKey,
    });

    return openai(config.modelId);
  }
}

/**
 * Singleton instance
 */
export const openaiProvider = new OpenAIProvider();
