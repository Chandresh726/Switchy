import { createCerebras } from "@ai-sdk/cerebras";

import { makeSdkProvider } from "./base-provider";

/**
 * Cerebras provider implementation (via shared SDK factory)
 */
export const cerebrasProvider = makeSdkProvider({
  id: "cerebras",
  name: "Cerebras",
  createClient: (apiKey) => createCerebras({ apiKey }),
});
