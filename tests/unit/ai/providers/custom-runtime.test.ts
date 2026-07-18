import { generateText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomProvider } from "@/lib/ai/providers/custom";

describe("CustomProvider real SDK authentication", () => {
  const fetchMock = vi.fn();

  function requestedUrl(): string {
    const input = fetchMock.mock.calls[0]?.[0];
    return input instanceof Request ? input.url : String(input);
  }

  function requestedBody(): Record<string, unknown> {
    return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
  }

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: { message: "stop after request construction", type: "test", code: "test" },
    }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("uses a custom Authorization header without requiring an API key", async () => {
    const model = new CustomProvider().createModel({
      config: { modelId: "responses-model" },
      providerConfig: {
        apiFormat: "openai_responses",
        baseUrl: "https://proxy.example/v1",
        headers: { authorization: "Bearer custom-token" },
      },
    });

    await expect(generateText({ model, prompt: "test", maxRetries: 0 })).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrl()).toBe("https://proxy.example/v1/responses");
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer custom-token");
  });

  it("supports a no-auth local Responses endpoint without sending the placeholder", async () => {
    const model = new CustomProvider().createModel({
      config: { modelId: "responses-model" },
      providerConfig: {
        apiFormat: "openai_responses",
        baseUrl: "http://127.0.0.1:8317/v1",
      },
    });

    await expect(generateText({ model, prompt: "test", maxRetries: 0 })).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrl()).toBe("http://127.0.0.1:8317/v1/responses");
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has("authorization")).toBe(false);
  });

  it("sends OpenAI-compatible chat requests to the chat completions path", async () => {
    const provider = new CustomProvider();
    const config = { modelId: "chat-model", reasoningEffort: "high" };
    const providerConfig = {
        apiFormat: "openai_chat_completions",
        baseUrl: "https://proxy.example/v1",
        headers: { Authorization: "Bearer custom-token" },
      } as const;
    const model = provider.createModel({ config, providerConfig });

    await expect(generateText({
      model,
      prompt: "test",
      maxRetries: 0,
      ...provider.getGenerationOptions(config, providerConfig),
    })).rejects.toBeDefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrl()).toBe("https://proxy.example/v1/chat/completions");
    expect(requestedBody().reasoning_effort).toBe("high");
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer custom-token");
  });

  it("sends reasoning effort to an OpenAI Responses endpoint", async () => {
    const provider = new CustomProvider();
    const config = { modelId: "responses-model", reasoningEffort: "xhigh" };
    const providerConfig = {
      apiFormat: "openai_responses",
      baseUrl: "http://127.0.0.1:8317/v1",
    } as const;
    const model = provider.createModel({ config, providerConfig });

    await expect(generateText({
      model,
      prompt: "test",
      maxRetries: 0,
      ...provider.getGenerationOptions(config, providerConfig),
    })).rejects.toBeDefined();

    expect(requestedUrl()).toBe("http://127.0.0.1:8317/v1/responses");
    expect(requestedBody().reasoning).toMatchObject({ effort: "xhigh" });
  });

  it("sends Anthropic-compatible requests to the messages path", async () => {
    const provider = new CustomProvider();
    const config = { modelId: "claude-model", reasoningEffort: "high" };
    const providerConfig = {
        apiFormat: "anthropic_messages",
        baseUrl: "https://proxy.example/v1",
        headers: {
          "X-API-Key": "header-key",
          "Anthropic-Version": "2025-01-01",
        },
      } as const;
    const model = provider.createModel({ config, providerConfig });

    await expect(generateText({
      model,
      prompt: "test",
      maxRetries: 0,
      ...provider.getGenerationOptions(config, providerConfig),
    })).rejects.toBeDefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrl()).toBe("https://proxy.example/v1/messages");
    expect(requestedBody()).toMatchObject({
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
    });
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-api-key")).toBe("header-key");
    expect(headers.get("anthropic-version")).toBe("2025-01-01");
  });
});
