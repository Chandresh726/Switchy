import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  createOpenRouter: vi.fn(),
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: mocks.createOpenRouter,
}));

import { OpenRouterProvider } from "@/lib/ai/providers/openrouter";

describe("OpenRouterProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chat.mockReturnValue({ modelId: "openrouter-model" });
    mocks.createOpenRouter.mockReturnValue({ chat: mocks.chat });
  });

  it("passes an advertised provider-native effort through extraBody", () => {
    const provider = new OpenRouterProvider();

    provider.createModel({
      config: { modelId: "provider/model", reasoningEffort: "max" },
      providerConfig: { apiKey: "sk-test" },
    });

    expect(mocks.chat).toHaveBeenCalledWith("provider/model", {
      extraBody: { reasoning: { effort: "max" } },
    });
  });

  it("omits reasoning when the resolved model uses provider default", () => {
    const provider = new OpenRouterProvider();

    provider.createModel({
      config: { modelId: "provider/model" },
      providerConfig: { apiKey: "sk-test" },
    });

    expect(mocks.chat).toHaveBeenCalledWith("provider/model", undefined);
  });
});
