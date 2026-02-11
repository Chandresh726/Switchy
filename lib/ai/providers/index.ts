import { SimpleProviderRegistry } from "./base-provider";
import { anthropicProvider } from "./anthropic";
import { googleProvider } from "./google";
import { openaiProvider } from "./openai";
import { openrouterProvider } from "./openrouter";
import { cerebrasProvider } from "./cerebras";
import { geminiCLIProvider } from "./gemini-cli";

// Create and populate the global provider registry
export const providerRegistry = new SimpleProviderRegistry();

// Register all providers
providerRegistry.register(anthropicProvider);
providerRegistry.register(googleProvider);
providerRegistry.register(openaiProvider);
providerRegistry.register(openrouterProvider);
providerRegistry.register(cerebrasProvider);
providerRegistry.register(geminiCLIProvider);

// Re-export types and classes
export * from "./types";
export * from "./base-provider";
export * from "./anthropic";
export * from "./google";
export * from "./openai";
export * from "./openrouter";
export * from "./cerebras";
export * from "./gemini-cli";
