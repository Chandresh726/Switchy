import { createGroq } from "@ai-sdk/groq";

import { makeSdkProvider } from "./base-provider";

/**
 * Groq provider implementation (via shared SDK factory)
 */
export const groqProvider = makeSdkProvider({
  id: "groq",
  name: "Groq",
  createClient: (apiKey) => createGroq({ apiKey }),
});
