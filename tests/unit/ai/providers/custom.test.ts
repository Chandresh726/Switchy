import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  anthropicMessages: vi.fn(),
  createAnthropic: vi.fn(),
  createOpenAI: vi.fn(),
  createOpenAICompatible: vi.fn(),
  openAIChat: vi.fn(),
  openAIResponses: vi.fn(),
}));

vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: mocks.createAnthropic }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: mocks.createOpenAI }));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mocks.createOpenAICompatible,
}));

import { CustomProvider } from "@/lib/ai/providers/custom";

describe("CustomProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOpenAICompatible.mockReturnValue({ chatModel: mocks.openAIChat });
    mocks.createOpenAI.mockReturnValue({ responses: mocks.openAIResponses });
    mocks.createAnthropic.mockReturnValue({ messages: mocks.anthropicMessages });
  });

  it("uses the OpenAI-compatible chat adapter", () => {
    const provider = new CustomProvider();
    provider.createModel({
      config: { modelId: "chat-model" },
      providerConfig: {
        apiFormat: "openai_chat_completions",
        baseUrl: "http://localhost:8317/v1",
        apiKey: "secret",
        headers: { authorization: "Bearer override", "X-Test": "value" },
      },
    });
    expect(mocks.createOpenAICompatible).toHaveBeenCalledWith({
      name: "custom",
      baseURL: "http://localhost:8317/v1",
      apiKey: "secret",
      headers: { Authorization: "Bearer override", "X-Test": "value" },
      fetch: expect.any(Function),
    });
    expect(mocks.openAIChat).toHaveBeenCalledWith("chat-model");
  });

  it("uses the OpenAI Responses adapter", () => {
    const provider = new CustomProvider();
    provider.createModel({
      config: { modelId: "responses-model" },
      providerConfig: {
        apiFormat: "openai_responses",
        baseUrl: "https://proxy.example/v1",
      },
    });
    expect(mocks.createOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      name: "custom",
      baseURL: "https://proxy.example/v1",
    }));
    expect(mocks.openAIResponses).toHaveBeenCalledWith("responses-model");
  });

  it("uses the Anthropic Messages adapter and supports header authentication", () => {
    const provider = new CustomProvider();
    provider.createModel({
      config: { modelId: "claude-model" },
      providerConfig: {
        apiFormat: "anthropic_messages",
        baseUrl: "https://proxy.example/v1",
        apiKey: "standard-key",
        headers: {
          "X-API-Key": "override-key",
          "Anthropic-Version": "2025-01-01",
        },
      },
    });
    expect(mocks.createAnthropic).toHaveBeenCalledWith(expect.objectContaining({
      name: "custom.messages",
      baseURL: "https://proxy.example/v1",
      apiKey: "override-key",
      headers: {
        "x-api-key": "override-key",
        "anthropic-version": "2025-01-01",
      },
      fetch: expect.any(Function),
    }));
    expect(mocks.anthropicMessages).toHaveBeenCalledWith("claude-model");
  });
});
