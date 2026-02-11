import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base-provider";
import type { AIProvider, ModelConfig, ProviderConfig } from "./types";

/**
 * Google Gemini provider using API Key
 */
export class GoogleProvider extends BaseProvider {
  readonly id: AIProvider = "gemini_api_key";
  readonly name = "Google Gemini (API Key)";
  readonly requiresApiKey = true;

  /**
   * Gemini 3.x models support reasoning effort
   */
  supportsReasoningEffort(modelId: string): boolean {
    return modelId.includes("gemini-3-");
  }

  /**
   * Google supports reasoning effort via providerOptions
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
        google: {
          reasoningEffort: config.reasoningEffort,
        },
      },
    };
  }

  protected createLanguageModel(
    config: ModelConfig,
    _providerConfig: ProviderConfig
  ): LanguageModel {
    const google = createGoogleGenerativeAI({
      apiKey: _providerConfig.apiKey,
    });

    return google(config.modelId);
  }
}

/**
 * Singleton instance
 */
export const googleProvider = new GoogleProvider();
