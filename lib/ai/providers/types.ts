import type { LanguageModel } from "ai";

/**
 * Supported AI providers
 */
const AI_PROVIDER_IDS = [
  "anthropic",
  "openai",
  "gemini_api_key",
  "openrouter",
  "cerebras",
  "groq",
  "nvidia",
  "codex_cli",
  "opencode_cli",
  "custom",
] as const;

export type AIProvider = (typeof AI_PROVIDER_IDS)[number];

const LOCAL_CLI_PROVIDER_IDS = ["codex_cli", "opencode_cli"] as const;
export type LocalCLIProvider = (typeof LOCAL_CLI_PROVIDER_IDS)[number];

export const CUSTOM_API_FORMATS = [
  "openai_chat_completions",
  "openai_responses",
  "anthropic_messages",
] as const;

export type CustomAPIFormat = (typeof CUSTOM_API_FORMATS)[number];

export function isCustomAPIFormat(value: string): value is CustomAPIFormat {
  return (CUSTOM_API_FORMATS as readonly string[]).includes(value);
}

export function isLocalCLIProvider(value: string): value is LocalCLIProvider {
  return (LOCAL_CLI_PROVIDER_IDS as readonly string[]).includes(value);
}

export function isAIProvider(value: string): value is AIProvider {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Provider-native reasoning option. Values are discovered from model catalogs. */
export type ReasoningEffort = string;

const MAX_REASONING_EFFORT_LENGTH = 64;
const REASONING_EFFORT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_REASONING_EFFORT_LENGTH &&
    REASONING_EFFORT_PATTERN.test(value);
}

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
  apiFormat?: CustomAPIFormat;
  headers?: Record<string, string>;
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
  /** Create a language model instance */
  createModel(options: CreateModelOptions): LanguageModel;
  /** Get provider-specific generation options (like reasoningEffort) */
  getGenerationOptions(
    config: ModelConfig,
    providerConfig?: ProviderConfig
  ): Record<string, unknown> | undefined;
}

export {
  AIError,
} from "../shared/errors";
