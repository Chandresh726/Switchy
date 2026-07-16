import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOpenAICompatible: vi.fn(),
  languageModel: {},
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mocks.createOpenAICompatible,
}));

import { NvidiaProvider } from "@/lib/ai/providers/nvidia";

describe("NvidiaProvider", () => {
  beforeEach(() => {
    mocks.createOpenAICompatible.mockReset();
    mocks.createOpenAICompatible.mockReturnValue(() => mocks.languageModel);
  });

  it("enables native JSON schema output for NVIDIA chat models", () => {
    const provider = new NvidiaProvider();

    expect(provider.createModel({
      config: { modelId: "openai/gpt-oss-120b" },
      providerConfig: { apiKey: "test-key" },
    })).toBe(mocks.languageModel);

    expect(mocks.createOpenAICompatible).toHaveBeenCalledWith({
      name: "nvidia",
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey: "test-key",
      supportsStructuredOutputs: true,
    });
  });
});
