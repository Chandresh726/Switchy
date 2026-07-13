import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  decryptApiKey: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mocks.select,
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

    queueSelectResponses({ limit: [providerRecord] }, { limit: [providerRecord] });

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

    queueSelectResponses({ limit: [providerRecord] }, { limit: [providerRecord] });

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

  it("resolves provider/model using default active provider and first valid model", async () => {
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
      { limit: [defaultProvider] }
    );

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "gpt-4.1", owned_by: "openai" }],
      }),
    });

    const selection = await resolveProviderModelSelection({
      modelId: "missing-model",
    });

    expect(selection).toEqual({
      providerId: "provider-default",
      provider: "openai",
      modelId: "gpt-4.1",
    });
  });
});
