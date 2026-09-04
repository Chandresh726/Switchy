import { createOpenAI } from "@ai-sdk/openai";

import { makeSdkProvider } from "./base-provider";

/**
 * OpenAI provider implementation (via shared SDK factory)
 */
export const openaiProvider = makeSdkProvider({
  id: "openai",
  name: "OpenAI",
  createClient: (apiKey) => createOpenAI({ apiKey }),
});
