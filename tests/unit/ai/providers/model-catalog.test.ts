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
      { limit: [providerRecord] }
    );

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "gpt-4.1-mini", owned_by: "openai" }],
        }),
      })
      .mockRejectedValueOnce(new Error("network down"));

    const live = await getProviderModels("provider-openai");
    const stale = await getProviderModels("provider-openai", { forceRefresh: true });

    expect(live.source).toBe("live");
    expect(stale.source).toBe("cache");
    expect(stale.isStale).toBe(true);
    expect(stale.warning).toContain("Failed to fetch models from openai");
    expect(stale.models).toEqual(live.models);
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
