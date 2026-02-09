import { createAnthropic } from "@ai-sdk/anthropic";

// Create an Anthropic-compatible client pointing to the local proxy
// SDK appends /messages to baseURL, so include /v1 path here
export const ai = createAnthropic({
  baseURL: "http://localhost:8080/v1",
  // No API key needed - proxy handles it
  apiKey: "dummy-key", // Required by SDK but proxy ignores it
});

// Default model for backwards compatibility
export const model = ai("gemini-3-flash");

/**
 * Get a model instance with a custom model ID.
 * Use this when you need to dynamically select a model based on settings.
 */
export function getModel(modelId: string) {
  return ai(modelId);
}
