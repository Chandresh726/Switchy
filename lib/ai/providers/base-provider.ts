import type { LanguageModel } from "ai";
import {
  type AIProviderInterface,
  type AIProvider,
  type CreateModelOptions,
  type ProviderConfig,
  type ModelConfig,
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
      throw new AIError(
        "missing_api_key",
        `${this.name} API Key is required but not provided`
      );
    }
  }

  /**
   * Get reasoning effort options for model creation
   * Override in subclasses to provide provider-specific reasoning options
   */
  protected getReasoningOptions(
    _modelId: string,
    reasoningEffort?: string
  ): Record<string, unknown> | undefined {
    // Base implementation returns the reasoning effort as a generic option
    // Subclasses should override this to provide provider-specific options
    if (reasoningEffort) {
      return { reasoningEffort };
    }
    return undefined;
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

    const reasoningOptions = this.getReasoningOptions(
      options.config.modelId,
      options.config.reasoningEffort
    );

    // Merge reasoning options into extra options if they exist
    if (reasoningOptions) {
      options.providerConfig.extraOptions = {
        ...options.providerConfig.extraOptions,
        ...reasoningOptions,
      };
    }

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
