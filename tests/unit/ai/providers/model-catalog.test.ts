import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  insertValues: vi.fn(),
  decryptApiKey: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
  },
}));

vi.mock("@/lib/encryption", () => ({
  decryptApiKey: mocks.decryptApiKey,
}));

vi.mock("server-only", () => ({}));

import {
  clearProviderModelsCache,
  discoverCustomProviderModels,
  getProviderModels,
  resolveProviderModelSelection,
} from "@/lib/ai/providers/model-catalog";

interface SelectResponse {
  limit?: unknown[];
  orderBy?: unknown[];
}

describe("model catalog", () => {
  let selectQueue: SelectResponse[];
  const fetchMock = vi.fn();

  beforeEach(() => {
    selectQueue = [];
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);

    mocks.decryptApiKey.mockReset();
    mocks.decryptApiKey.mockReturnValue("sk-test");

    mocks.select.mockReset();
    mocks.insert.mockReset();
    mocks.insertValues.mockReset();
    mocks.insert.mockReturnValue({
      values: (value: unknown) => {
        mocks.insertValues(value);
        return { onConflictDoUpdate: async () => undefined };
      },
    });
    mocks.select.mockImplementation(() => {
      const response = selectQueue.shift() ?? {};
      return {
        from: () => ({
          where: () => ({
            limit: async () => response.limit ?? [],
            orderBy: async () => response.orderBy ?? [],
          }),
          orderBy: async () => response.orderBy ?? [],
          limit: async () => response.limit ?? [],
        }),
      };
    });

    clearProviderModelsCache();
  });

  function queueSelectResponses(...responses: SelectResponse[]) {
    selectQueue.push(...responses);
  }

  it("filters non-text models, deduplicates, and reuses cache", async () => {
    const providerRecord = {
      id: "provider-openai",
      provider: "openai",
      apiKey: "encrypted-key",
      updatedAt: new Date("2026-02-20T00:00:00.000Z"),
    };

    queueSelectResponses(
      { limit: [providerRecord] },
      { limit: [] },
      { limit: [providerRecord] }
    );

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "gpt-4o-mini", owned_by: "openai" },
          { id: "text-embedding-3-small", owned_by: "openai" },
          { id: "gpt-4o-mini", owned_by: "openai" },
        ],
      }),
    });

    const first = await getProviderModels("provider-openai");
    const second = await getProviderModels("provider-openai");

    expect(first.source).toBe("live");
    expect(first.models.map((model) => model.modelId)).toEqual(["gpt-4o-mini"]);

    expect(second.source).toBe("cache");
    expect(second.isStale).toBe(false);
    expect(second.models.map((model) => model.modelId)).toEqual(["gpt-4o-mini"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("discovers OpenAI-style custom models with bearer authentication and manual additions", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
        data: [
          { id: "proxy-model", owned_by: "cliproxy" },
          { id: "embedding-model", owned_by: "cliproxy" },
        ],
      })));

    const models = await discoverCustomProviderModels({
      displayName: "Local proxy",
      apiFormat: "openai_chat_completions",
      baseUrl: "http://127.0.0.1:8317/v1",
      apiKey: "proxy-key",
      headers: { "X-Route": "codex" },
      manualModelIds: ["manual-model", "proxy-model"],
      reasoningEfforts: ["low", "medium", "high", "xhigh"],
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8317/v1/models");
    const openAIHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(openAIHeaders.get("authorization")).toBe("Bearer proxy-key");
    expect(openAIHeaders.get("x-route")).toBe("codex");
    expect(models.map(({ modelId }) => modelId)).toEqual(["proxy-model", "manual-model"]);
    expect(models[0]).toMatchObject({
      supportsReasoning: true,
      reasoningControl: {
        kind: "effort",
        options: [
          { value: "low" },
          { value: "medium" },
          { value: "high" },
          { value: "xhigh" },
        ],
        defaultValue: "medium",
      },
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
      defaultReasoningEffort: "medium",
    });
    expect(models[1]?.reasoningControl).toEqual(models[0]?.reasoningControl);
  });

  it("advertises verified GPT-5.6 reasoning efforts for an OpenAI-compatible custom provider", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: "gpt-5.6-luna", owned_by: "openai" },
        { id: "gpt-5.6-sol", owned_by: "openai" },
        { id: "gpt-5.6-terra", owned_by: "openai" },
        { id: "gpt-5.6-preview", owned_by: "openai" },
        { id: "proxy-model", owned_by: "cliproxy" },
      ],
    })));

    const models = await discoverCustomProviderModels({
      displayName: "CLI Proxy API",
      apiFormat: "openai_responses",
      baseUrl: "http://127.0.0.1:8317/v1",
      headers: {},
      manualModelIds: [],
      reasoningEfforts: [],
    });

    for (const modelId of ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]) {
      expect(models.find((model) => model.modelId === modelId)).toMatchObject({
        supportsReasoning: true,
        reasoningControl: {
          kind: "effort",
          options: ["none", "low", "medium", "high", "xhigh", "max"]
            .map((value) => ({ value })),
          defaultValue: "medium",
        },
      });
    }
    expect(models.find((model) => model.modelId === "gpt-5.6-preview")?.reasoningControl)
      .toEqual({ kind: "provider_default" });
    expect(models.find((model) => model.modelId === "proxy-model")?.reasoningControl)
      .toEqual({ kind: "provider_default" });
  });

  it("parses Anthropic-style custom catalogs and does not expose error bodies", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "claude-proxy", display_name: "Claude Proxy", type: "model" }],
      })));
    const models = await discoverCustomProviderModels({
      displayName: "Anthropic proxy",
      apiFormat: "anthropic_messages",
      baseUrl: "https://proxy.example/v1",
      apiKey: "secret-key",
      headers: {},
      manualModelIds: [],
      reasoningEfforts: [],
    });
    expect(models[0]).toMatchObject({ modelId: "claude-proxy", label: "Claude Proxy" });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("https://proxy.example/v1/models");
    const anthropicHeaders = new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers);
    expect(anthropicHeaders.get("x-api-key")).toBe("secret-key");
    expect(anthropicHeaders.get("anthropic-version")).toBe("2023-06-01");

    const rejectedResponse = new Response("request echoed secret-key", {
      status: 401,
    });
    const cancel = vi.spyOn(rejectedResponse.body!, "cancel");
    fetchMock.mockResolvedValueOnce(rejectedResponse);
    await expect(discoverCustomProviderModels({
      displayName: "Anthropic proxy",
      apiFormat: "anthropic_messages",
      baseUrl: "https://proxy.example/v1",
      apiKey: "secret-key",
      headers: {},
      manualModelIds: [],
      reasoningEfforts: [],
    })).rejects.not.toMatchObject({ context: { body: expect.anything() } });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    {},
    { data: {} },
    { data: [null] },
  ])("rejects malformed custom catalog shapes with an AI error", async (payload) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload)));

    await expect(discoverCustomProviderModels({
      displayName: "Malformed proxy",
      apiFormat: "openai_chat_completions",
      baseUrl: "https://malformed.example/v1",
      headers: {},
      manualModelIds: ["manual-model"],
      reasoningEfforts: [],
    })).rejects.toMatchObject({
      type: "validation",
      message: "Invalid custom provider model catalog",
    });
  });

  it("bounds custom discovery time and response size", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValueOnce(timeout);
    await expect(discoverCustomProviderModels({
      displayName: "Slow proxy",
      apiFormat: "openai_chat_completions",
      baseUrl: "https://slow.example/v1",
      headers: {},
      manualModelIds: [],
      reasoningEfforts: [],
    })).rejects.toMatchObject({ message: "Custom provider model discovery timed out" });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);

    const oversizedResponse = new Response("{}", {
      headers: { "content-length": String(2 * 1024 * 1024 + 1) },
    });
    const cancel = vi.spyOn(oversizedResponse.body!, "cancel");
    cancel.mockRejectedValueOnce(new Error("cancel failed"));
    fetchMock.mockResolvedValueOnce(oversizedResponse);
    await expect(discoverCustomProviderModels({
      displayName: "Large proxy",
      apiFormat: "openai_chat_completions",
      baseUrl: "https://large.example/v1",
      headers: {},
      manualModelIds: ["manual-model"],
      reasoningEfforts: [],
    })).rejects.toMatchObject({ message: "Invalid model catalog response from custom" });
    expect(cancel).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: null,
      text: async () => "x".repeat(2 * 1024 * 1024 + 1),
    });
    await expect(discoverCustomProviderModels({
      displayName: "Bodyless proxy",
      apiFormat: "openai_chat_completions",
      baseUrl: "https://bodyless.example/v1",
      headers: {},
      manualModelIds: ["manual-model"],
      reasoningEfforts: [],
    })).rejects.toMatchObject({ message: "Invalid model catalog response from custom" });
  });

  it("rejects a discovered and manual catalog whose final deduplicated size exceeds the cache bound", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: Array.from({ length: 900 }, (_, index) => ({ id: `remote-${index}` })),
    })));
    await expect(discoverCustomProviderModels({
      displayName: "Large catalog",
      apiFormat: "openai_chat_completions",
      baseUrl: "https://large.example/v1",
      headers: {},
      manualModelIds: Array.from({ length: 200 }, (_, index) => `manual-${index}`),
      reasoningEfforts: [],
    })).rejects.toMatchObject({
      message: "The custom provider catalog cannot contain more than 1,000 models",
    });
  });

  it("returns stale cache with warning when refresh fails", async () => {
    const providerRecord = {
      id: "provider-openai",
      provider: "openai",
      apiKey: "encrypted-key",
      updatedAt: new Date("2026-02-20T00:00:00.000Z"),
    };

    queueSelectResponses(
      { limit: [providerRecord] },
      { limit: [] },
      { limit: [providerRecord] },
      { limit: [providerRecord] }
    );

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "gpt-4.1-mini", owned_by: "openai" }],
        }),
      })
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("still down"));

    const live = await getProviderModels("provider-openai");
    const stale = await getProviderModels("provider-openai", { forceRefresh: true });

    expect(live.source).toBe("live");
    expect(stale.source).toBe("cache");
    expect(stale.isStale).toBe(true);
    expect(stale.warning).toContain("Failed to fetch models from openai");
    expect(stale.models).toEqual(live.models);

    await expect(getProviderModels("provider-openai", {
      forceRefresh: true,
      allowStaleOnError: false,
    })).rejects.toMatchObject({
      type: "network",
      message: "Failed to fetch models from openai",
    });
  });

  it("preserves OpenRouter reasoning efforts, ordering, and default from the catalog", async () => {
    const providerRecord = {
      id: "provider-openrouter",
      provider: "openrouter",
      apiKey: "encrypted-key",
      updatedAt: new Date("2026-02-20T00:00:00.000Z"),
    };
    queueSelectResponses({ limit: [providerRecord] }, { limit: [] });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          id: "provider/future-model",
          name: "Future model",
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
          supported_parameters: ["reasoning"],
          reasoning: {
            supported_efforts: ["max", "xhigh", "medium", "future_v1"],
            default_effort: "xhigh",
          },
        }],
      }),
    });

    const response = await getProviderModels(providerRecord.id);
    expect(response.models[0]).toMatchObject({
      reasoningControl: {
        kind: "effort",
        options: [
          { value: "max" },
          { value: "xhigh" },
          { value: "medium" },
          { value: "future_v1" },
        ],
        defaultValue: "xhigh",
      },
      supportedReasoningEfforts: ["max", "xhigh", "medium", "future_v1"],
      defaultReasoningEffort: "xhigh",
    });
  });

  it("bounds provider display metadata without dropping discovered reasoning options", async () => {
    const providerRecord = {
      id: "provider-openrouter-verbose",
      provider: "openrouter",
      apiKey: "encrypted-key",
      updatedAt: new Date("2026-02-20T00:00:00.000Z"),
    };
    queueSelectResponses({ limit: [providerRecord] }, { limit: [] });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          id: "provider/verbose-model",
          name: "N".repeat(300),
          description: "D".repeat(2_500),
          reasoning: {
            supported_efforts: ["xhigh", "max", "future_v1"],
            default_effort: "max",
          },
        }],
      }),
    });

    const response = await getProviderModels(providerRecord.id);

    expect(response.source).toBe("live");
    expect(response.models[0]?.label).toHaveLength(240);
    expect(response.models[0]?.description).toHaveLength(2_000);
    expect(response.models[0]?.reasoningControl).toEqual({
      kind: "effort",
      options: [{ value: "xhigh" }, { value: "max" }, { value: "future_v1" }],
      defaultValue: "max",
    });
    const stored = mocks.insertValues.mock.calls.at(-1)?.[0] as { value: string };
    expect(stored.value).toContain("future_v1");
  });

  it("reuses validated reasoning metadata from the durable cache without discovery", async () => {
    const providerRecord = {
      id: "provider-openrouter-durable",
      provider: "openrouter",
      apiKey: "encrypted-key",
      updatedAt: new Date("2026-02-20T00:00:00.000Z"),
    };
    queueSelectResponses({ limit: [providerRecord] }, { limit: [] });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          id: "provider/model",
          reasoning: {
            supported_efforts: ["xhigh", "max"],
            default_effort: "xhigh",
          },
        }],
      }),
    });
    await getProviderModels(providerRecord.id);
    const stored = mocks.insertValues.mock.calls.at(-1)?.[0] as { value: string };
    clearProviderModelsCache(providerRecord.id);
    queueSelectResponses(
      { limit: [{ id: providerRecord.id, updatedAt: providerRecord.updatedAt }] },
      { limit: [{ value: stored.value }] }
    );

    const { getCachedProviderModelDefinition } = await import(
      "@/lib/ai/providers/model-catalog"
    );
    const cached = await getCachedProviderModelDefinition(
      providerRecord.id,
      "provider/model"
    );

    expect(cached?.reasoningControl).toEqual({
      kind: "effort",
      options: [{ value: "xhigh" }, { value: "max" }],
      defaultValue: "xhigh",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes durable catalogs created before model-specific capability inference", async () => {
    const providerRecord = {
      id: "provider-openai-old-cache",
      provider: "openai",
      apiKey: "encrypted-key",
      updatedAt: new Date("2026-02-20T00:00:00.000Z"),
    };
    queueSelectResponses(
      { limit: [providerRecord] },
      { limit: [{
        value: JSON.stringify({
          providerUpdatedAtMs: providerRecord.updatedAt.getTime(),
          fetchedAt: new Date().toISOString(),
          models: [],
        }),
      }] }
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-5.6-luna", owned_by: "openai" }] }),
    });

    const response = await getProviderModels(providerRecord.id);

    expect(response.source).toBe("live");
    expect(fetchMock).toHaveBeenCalledOnce();
    const stored = mocks.insertValues.mock.calls.at(-1)?.[0] as { value: string };
    expect(JSON.parse(stored.value)).toMatchObject({ schemaVersion: 2 });
  });

  it("uses provider-default when a catalog does not enumerate exact efforts", async () => {
    const providerRecord = {
      id: "provider-gemini",
      provider: "gemini_api_key",
      apiKey: "encrypted-key",
      updatedAt: new Date("2026-02-20T00:00:00.000Z"),
    };
    queueSelectResponses({ limit: [providerRecord] }, { limit: [] });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{
          name: "models/gemini-thinking",
          displayName: "Gemini Thinking",
          supportedGenerationMethods: ["generateContent"],
          thinking: true,
        }],
      }),
    });

    const response = await getProviderModels(providerRecord.id);
    expect(response.models[0]).toMatchObject({
      supportsReasoning: true,
      reasoningControl: { kind: "provider_default" },
    });
    expect(response.models[0]?.supportedReasoningEfforts).toBeUndefined();
  });

  it("does not silently replace a configured unavailable model", async () => {
    const defaultProvider = {
      id: "provider-default",
      provider: "openai",
      apiKey: "encrypted-key",
      updatedAt: new Date("2026-02-20T00:00:00.000Z"),
      isDefault: true,
      createdAt: new Date("2026-02-19T00:00:00.000Z"),
    };

    queueSelectResponses(
      { orderBy: [defaultProvider] },
      { limit: [defaultProvider] },
      { limit: [] }
    );

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "gpt-4.1", owned_by: "openai" }],
      }),
    });

    await expect(
      resolveProviderModelSelection({ modelId: "missing-model" })
    ).rejects.toMatchObject({
      type: "invalid_model",
      message: expect.stringContaining("missing-model"),
    });
  });
});
