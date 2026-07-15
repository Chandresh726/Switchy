import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base-provider";
import type { AIProvider, ModelConfig, ProviderConfig } from "./types";

/**
 * Groq provider implementation
 */
export class GroqProvider extends BaseProvider {
  readonly id: AIProvider = "groq";
  readonly name = "Groq";
  readonly requiresApiKey = true;

  protected createLanguageModel(
    config: ModelConfig,
    _providerConfig: ProviderConfig
  ): LanguageModel {
    const groq = createGroq({
      apiKey: _providerConfig.apiKey,
    });

    return groq(config.modelId);
  }
}

/**
 * Singleton instance
 */
export const groqProvider = new GroqProvider();
