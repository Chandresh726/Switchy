import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  decryptApiKey: vi.fn(),
  getProviderModelsForResolvedProvider: vi.fn(),
  createModel: vi.fn(),
  getGenerationOptions: vi.fn(),
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

vi.mock("@/lib/ai/providers/model-catalog", () => ({
  getProviderModelsForResolvedProvider: mocks.getProviderModelsForResolvedProvider,
}));

vi.mock("@/lib/ai/providers", () => ({
  providerRegistry: {
    get: () => ({
      requiresApiKey: true,
      createModel: mocks.createModel,
      getGenerationOptions: mocks.getGenerationOptions,
    }),
  },
}));

import {
  resolveAIContextForCapability,
} from "@/lib/ai/runtime-context";

interface SelectResponse {
  rows: unknown[];
}

function providerRecord() {
  return {
    id: "provider-1",
    provider: "openai",
    apiKey: "encrypted-key",
    isActive: true,
    isDefault: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  };
}

describe("AI runtime context resolution", () => {
  let selectQueue: SelectResponse[];
  const onConflictDoUpdate = vi.fn();
  const values = vi.fn(() => ({ onConflictDoUpdate }));

  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue = [];
    mocks.decryptApiKey.mockReturnValue("decrypted-key");
    mocks.createModel.mockReturnValue({ modelId: "model-instance" });
    mocks.getGenerationOptions.mockReturnValue({ providerOptions: { openai: {} } });
    mocks.insert.mockReturnValue({ values });
    onConflictDoUpdate.mockResolvedValue(undefined);

    mocks.select.mockImplementation(() => ({
      from: () => ({
        where: () => {
          const response = selectQueue.shift() ?? { rows: [] };
          const direct = Promise.resolve(response.rows);
          return Object.assign(direct, {
            limit: async () => response.rows,
            orderBy: () => ({ limit: async () => response.rows }),
          });
        },
      }),
    }));
  });

  it("reads and decrypts the provider once and keeps the configured model exact", async () => {
    selectQueue.push(
      {
        rows: [
          { key: "matcher_model", value: "configured-model" },
          { key: "matcher_provider_id", value: "provider-1" },
          { key: "matcher_reasoning_effort", value: "high" },
        ],
      },
      { rows: [providerRecord()] }
    );

    const context = await resolveAIContextForCapability("job_analysis");

    expect(context).toMatchObject({
      providerRecordId: "provider-1",
      providerId: "provider-1",
      provider: "openai",
      modelId: "configured-model",
      reasoningEffort: "high",
    });
    expect(mocks.decryptApiKey).toHaveBeenCalledTimes(1);
    expect(mocks.createModel).toHaveBeenCalledWith({
      config: { modelId: "configured-model", reasoningEffort: "high" },
      providerConfig: { apiKey: "decrypted-key" },
    });
    expect(mocks.getProviderModelsForResolvedProvider).not.toHaveBeenCalled();
  });

  it("performs one initialization lookup and persists a concrete missing default model", async () => {
    selectQueue.push(
      {
        rows: [
          { key: "resume_parser_provider_id", value: "provider-1" },
          { key: "resume_parser_reasoning_effort", value: "medium" },
        ],
      },
      { rows: [providerRecord()] },
      { rows: [] }
    );
    mocks.getProviderModelsForResolvedProvider.mockResolvedValue({
      providerId: "provider-1",
      provider: "openai",
      models: [{ modelId: "initialized-model" }],
      fetchedAt: new Date().toISOString(),
      isStale: false,
      source: "live",
    });

    const context = await resolveAIContextForCapability("resume_parse");

    expect(context.modelId).toBe("initialized-model");
    expect(mocks.decryptApiKey).toHaveBeenCalledTimes(1);
    expect(mocks.getProviderModelsForResolvedProvider).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "resume_parser_model",
        value: "initialized-model",
      })
    );
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("single-flights concurrent missing-model initialization", async () => {
    selectQueue.push(
      {
        rows: [
          { key: "resume_parser_provider_id", value: "provider-1" },
          { key: "resume_parser_reasoning_effort", value: "medium" },
        ],
      },
      {
        rows: [
          { key: "resume_parser_provider_id", value: "provider-1" },
          { key: "resume_parser_reasoning_effort", value: "medium" },
        ],
      },
      { rows: [providerRecord()] },
      { rows: [providerRecord()] },
      { rows: [] }
    );
    const discovery = Promise.withResolvers<{
      providerId: string;
      provider: string;
      models: Array<{ modelId: string }>;
      fetchedAt: string;
      isStale: boolean;
      source: string;
    }>();
    mocks.getProviderModelsForResolvedProvider.mockReturnValue(discovery.promise);

    const first = resolveAIContextForCapability("resume_parse");
    const second = resolveAIContextForCapability("resume_parse");
    await vi.waitFor(() => {
      expect(mocks.getProviderModelsForResolvedProvider).toHaveBeenCalledTimes(1);
    });
    discovery.resolve({
      providerId: "provider-1",
      provider: "openai",
      models: [{ modelId: "initialized-model" }],
      fetchedAt: new Date().toISOString(),
      isStale: false,
      source: "live",
    });

    const [firstContext, secondContext] = await Promise.all([first, second]);
    expect(firstContext.modelId).toBe("initialized-model");
    expect(secondContext.modelId).toBe("initialized-model");
    expect(mocks.getProviderModelsForResolvedProvider).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("fails clearly when an explicit provider is unavailable", async () => {
    selectQueue.push({ rows: [] }, { rows: [] });

    await expect(
      resolveAIContextForCapability("job_analysis", {
        providerId: "missing-provider",
        modelId: "configured-model",
      })
    ).rejects.toMatchObject({
      type: "provider_not_found",
      message: expect.stringContaining("missing-provider"),
    });
    expect(mocks.createModel).not.toHaveBeenCalled();
  });
});
