import { createGoogle } from "@ai-sdk/google";

import { makeSdkProvider } from "./base-provider";

/**
 * Google Gemini provider using API Key (via shared SDK factory)
 */
export const googleProvider = makeSdkProvider({
  id: "gemini_api_key",
  name: "Google Gemini",
  createClient: (apiKey) => createGoogle({ apiKey }),
});
