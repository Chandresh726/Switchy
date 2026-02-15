import type { LanguageModel } from "ai";

/**
 * Supported AI providers
 */
export type AIProvider =
  | "anthropic"
  | "openai"
  | "gemini_api_key"
  | "gemini_cli_oauth"
  | "openrouter"
  | "cerebras"
  | "modal";

/**
 * Reasoning effort levels for models that support it
 */
export type ReasoningEffort = "low" | "medium" | "high";

/**
 * Configuration for creating an AI model instance
 */
export interface ModelConfig {
  /** The model identifier (e.g., "claude-sonnet-4-5", "gemini-3-flash-preview") */
  modelId: string;
  /** Optional reasoning effort for supported models */
  reasoningEffort?: ReasoningEffort;
}

/**
 * Provider-specific configuration options
 */
export interface ProviderConfig {
  /** The API key for the provider (if required) */
  apiKey?: string;
  /** Optional base URL override */
  baseUrl?: string;
  /** Additional provider-specific options */
  extraOptions?: Record<string, unknown>;
}

/**
 * Options for model creation
 */
export interface CreateModelOptions {
  /** The model configuration */
  config: ModelConfig;
  /** The provider configuration */
  providerConfig: ProviderConfig;
}

/**
 * Interface that all AI providers must implement
 */
export interface AIProviderInterface {
  /** Unique identifier for the provider */
  readonly id: AIProvider;
  /** Human-readable name */
  readonly name: string;
  /** Whether this provider requires an API key */
  readonly requiresApiKey: boolean;
  /** Whether this provider supports reasoning effort */
  supportsReasoningEffort(modelId: string): boolean;
  /** Create a language model instance */
  createModel(options: CreateModelOptions): LanguageModel;
  /** Get provider-specific generation options (like reasoningEffort) */
  getGenerationOptions(
    config: ModelConfig,
    providerConfig?: ProviderConfig
  ): Record<string, unknown> | undefined;
}

/**
 * Registry of all available providers
 */
export interface ProviderRegistry {
  get(providerId: AIProvider): AIProviderInterface | undefined;
  register(provider: AIProviderInterface): void;
  getAll(): AIProviderInterface[];
}

/**
 * Error types specific to AI operations
 */
export type AIErrorType =
  | "provider_not_found"
  | "missing_api_key"
  | "invalid_model"
  | "reasoning_not_supported"
  | "generation_failed"
  | "decryption_failed"
  | "timeout"
  | "rate_limit"
  | "network"
  | "unknown";

/**
 * Custom error class for AI-related errors
 */
export class AIError extends Error {
  constructor(
    public readonly type: AIErrorType,
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "AIError";
  }
}

/**
 * Settings required for AI client initialization
 */
export interface AIClientSettings {
  aiProvider: AIProvider;
  anthropicApiKey?: string;
  googleAuthMode?: "oauth" | "api_key";
  googleApiKey?: string;
  openrouterApiKey?: string;
  cerebrasApiKey?: string;
  openaiApiKey?: string;
  modalApiKey?: string;
}
