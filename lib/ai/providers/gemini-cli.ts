import { createGeminiProvider } from "ai-sdk-provider-gemini-cli";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base-provider";
import type { AIProvider, ModelConfig, ProviderConfig } from "./types";

/**
 * Google Gemini CLI OAuth provider
 * Uses local CLI authentication instead of API key
 */
export class GeminiCLIProvider extends BaseProvider {
  readonly id: AIProvider = "gemini_cli_oauth";
  readonly name = "Google Gemini (CLI OAuth)";
  readonly requiresApiKey = false;

  /**
   * Gemini 3.x models support reasoning effort
   */
  supportsReasoningEffort(modelId: string): boolean {
    return modelId.includes("gemini-3-");
  }

  /**
   * Gemini CLI supports reasoning effort via providerOptions
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
        gemini: {
          reasoningEffort: config.reasoningEffort,
        },
      },
    };
  }

  protected createLanguageModel(
    config: ModelConfig,
    _providerConfig: ProviderConfig
  ): LanguageModel {
    const google = createGeminiProvider();
    return google(config.modelId);
  }
}

/**
 * Singleton instance
 */
export const geminiCLIProvider = new GeminiCLIProvider();
