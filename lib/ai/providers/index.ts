import { SimpleProviderRegistry } from "./base-provider";
import { anthropicProvider } from "./anthropic";
import { googleProvider } from "./google";
import { openaiProvider } from "./openai";
import { openrouterProvider } from "./openrouter";
import { cerebrasProvider } from "./cerebras";
import { modalProvider } from "./modal";
import { groqProvider } from "./groq";
import { nvidiaProvider } from "./nvidia";

// Create and populate the global provider registry
export const providerRegistry = new SimpleProviderRegistry();

// Register all providers
providerRegistry.register(anthropicProvider);
providerRegistry.register(googleProvider);
providerRegistry.register(openaiProvider);
providerRegistry.register(openrouterProvider);
providerRegistry.register(cerebrasProvider);
providerRegistry.register(modalProvider);
providerRegistry.register(groqProvider);
providerRegistry.register(nvidiaProvider);

// Re-export types and classes
export * from "./types";
export * from "./base-provider";
export * from "./anthropic";
export * from "./google";
export * from "./openai";
export * from "./openrouter";
export * from "./cerebras";
export * from "./modal";
export * from "./groq";
export * from "./nvidia";
export * from "./models";
export * from "./metadata";
