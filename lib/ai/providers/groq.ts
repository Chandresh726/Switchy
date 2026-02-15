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

  /**
   * Groq models that support reasoning effort
   */
  supportsReasoningEffort(modelId: string): boolean {
    const reasoningModels = [
      "llama-3.3-70b-versatile",
      "gpt-oss-120b",
      "gpt-oss-20b",
      "qwen3-32b",
    ];
    return reasoningModels.some((model) => modelId.includes(model));
  }

  /**
   * Groq supports reasoning effort via providerOptions
   */
  getGenerationOptions(
    config: ModelConfig,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _providerConfig: ProviderConfig
  ): Record<string, unknown> | undefined {
    if (!config.reasoningEffort || !this.supportsReasoningEffort(config.modelId)) {
      return undefined;
    }

    let reasoningEffort: "low" | "medium" | "high" | "default" | "none" | undefined;

    if (config.modelId.includes("qwen3-32b")) {
      reasoningEffort = config.reasoningEffort === "low" ? "none" : "default";
    } else {
      reasoningEffort = config.reasoningEffort;
    }

    return {
      providerOptions: {
        groq: {
          reasoningEffort,
        },
      },
    };
  }

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
