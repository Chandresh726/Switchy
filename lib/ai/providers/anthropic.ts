import { createAnthropic } from "@ai-sdk/anthropic";

import { makeSdkProvider } from "./base-provider";

/**
 * Anthropic Claude provider implementation (via shared SDK factory)
 */
export const anthropicProvider = makeSdkProvider({
  id: "anthropic",
  name: "Anthropic (Claude)",
  createClient: (apiKey) => createAnthropic({ apiKey }),
});
