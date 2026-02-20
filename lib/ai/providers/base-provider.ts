import type { LanguageModel } from "ai";
import {
  type AIProviderInterface,
  type AIProvider,
  type CreateModelOptions,
  type ProviderConfig,
  type ModelConfig,
  type ReasoningEffort,
  AIError,
} from "./types";

/**
 * Abstract base class for AI providers
 * Implements common functionality and enforces interface compliance
 */
export abstract class BaseProvider implements AIProviderInterface {
  abstract readonly id: AIProvider;
  abstract readonly name: string;
  abstract readonly requiresApiKey: boolean;

  /**
   * Check if a model supports reasoning effort
   * Default implementation can be overridden by subclasses
   */
  abstract supportsReasoningEffort(modelId: string): boolean;

  /**
   * Validate the provider configuration
   * @throws AIError if configuration is invalid
   */
  protected validateConfig(config: ProviderConfig): void {
    if (this.requiresApiKey && !config.apiKey) {
      throw new AIError({
        type: "missing_api_key",
        message: `${this.name} API Key is required but not provided`,
      });
    }
  }

  protected buildProviderReasoningOptions(
    providerKey: string,
    config: ModelConfig,
    transform?: (reasoningEffort: ReasoningEffort, config: ModelConfig) => unknown
  ): Record<string, unknown> | undefined {
    if (!config.reasoningEffort || !this.supportsReasoningEffort(config.modelId)) {
      return undefined;
    }

    const reasoningEffort = transform
      ? transform(config.reasoningEffort, config)
      : config.reasoningEffort;

    return {
      providerOptions: {
        [providerKey]: {
          reasoningEffort,
        },
      },
    };
  }

  /**
   * Create the actual language model instance
   * Must be implemented by subclasses
   */
  protected abstract createLanguageModel(
    config: ModelConfig,
    providerConfig: ProviderConfig
  ): LanguageModel;

  /**
   * Get provider-specific options for AI generation calls
   * Override in subclasses to provide options like reasoningEffort
   */
  getGenerationOptions(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: ModelConfig,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _providerConfig: ProviderConfig
  ): Record<string, unknown> | undefined {
    return undefined;
  }

  /**
   * Public method to create a model
   * Validates config and creates the model
   */
  createModel(options: CreateModelOptions): LanguageModel {
    this.validateConfig(options.providerConfig);

    return this.createLanguageModel(options.config, options.providerConfig);
  }

  /**
   * Get generation options for a specific model configuration
   * Public wrapper around getGenerationOptions
   */
  getProviderOptions(config: ModelConfig): Record<string, unknown> | undefined {
    return this.getGenerationOptions(config, { apiKey: "" });
  }
}

/**
 * Simple implementation of provider registry
 */
export class SimpleProviderRegistry {
  private providers = new Map<AIProvider, AIProviderInterface>();

  register(provider: AIProviderInterface): void {
    this.providers.set(provider.id, provider);
  }

  get(providerId: AIProvider): AIProviderInterface | undefined {
    return this.providers.get(providerId);
  }

  getAll(): AIProviderInterface[] {
    return Array.from(this.providers.values());
  }

  has(providerId: AIProvider): boolean {
    return this.providers.has(providerId);
  }
}
