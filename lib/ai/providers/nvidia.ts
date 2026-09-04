import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { makeSdkProvider } from "./base-provider";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

/**
 * NVIDIA (NIM) provider (via shared SDK factory)
 */
export const nvidiaProvider = makeSdkProvider({
  id: "nvidia",
  name: "NVIDIA (NIM)",
  createClient: (apiKey) =>
    createOpenAICompatible({
      name: "nvidia",
      baseURL: NVIDIA_BASE_URL,
      apiKey,
      supportsStructuredOutputs: true,
    }),
});
