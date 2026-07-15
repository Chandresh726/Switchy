import { asc } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createLocalCLICatalogCache } from "@/lib/ai/local-cli/catalog-cache";
import {
  createProvider,
  deleteProvider,
  listProviders,
  toProviderPublic,
} from "@/lib/ai/providers/provider-service";
import { aiProviders, settings } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-cli-providers-");

describe("local CLI provider records", () => {
  it("starts empty and exposes explicitly added CLI records without credentials", async () => {
    const { database } = harness.createDatabase();

    expect(await listProviders(database)).toEqual([]);
    const created = await createProvider({ provider: "codex_cli" }, database);

    const providers = await database.select().from(aiProviders).orderBy(asc(aiProviders.id));
    expect(providers).toEqual([expect.objectContaining({
      id: created.id,
      provider: "codex_cli",
      apiKey: null,
      isDefault: true,
      isActive: true,
    })]);
    expect(JSON.stringify(providers.map(toProviderPublic))).not.toContain("apiKey");
    expect(JSON.stringify(providers.map(toProviderPublic))).not.toContain("credential");
    await expect(createProvider({ provider: "codex_cli" }, database)).rejects.toThrow(
      "already been added"
    );
  });

  it("moves feature selections to an available provider and model when deleting one", async () => {
    const { database } = harness.createDatabase();
    const selected = await createProvider({ provider: "codex_cli" }, database);
    const fallback = await createProvider({ provider: "opencode_cli" }, database);
    await database.insert(settings).values([
      { key: "matcher_provider_id", value: selected.id },
      { key: "matcher_model", value: "codex-model" },
      { key: "matcher_reasoning_effort", value: "high" },
      { key: "ai_writing_provider_id", value: selected.id },
      { key: "ai_writing_model", value: "codex-model" },
      { key: "ai_writing_reasoning_effort", value: "high" },
    ]);

    const result = await deleteProvider(selected.id, {
      database,
      deleteModelsCache: vi.fn().mockResolvedValue(undefined),
      resetLocalProvider: vi.fn().mockResolvedValue(undefined),
      resolveModels: vi.fn().mockResolvedValue({
        models: [{
          modelId: "fallback-model",
          label: "Fallback model",
          description: "",
          supportsReasoning: true,
          reasoningControl: {
            kind: "effort" as const,
            options: [{ value: "medium" }],
            defaultValue: "medium",
          },
          supportedReasoningEfforts: ["medium"],
          defaultReasoningEffort: "medium",
          isDefault: true,
        }],
      }),
    });

    const storedSettings = new Map(
      (await database.select().from(settings)).map(({ key, value }) => [key, value])
    );
    expect(result).toEqual({
      fallbackProviderId: fallback.id,
      fallbackModelId: "fallback-model",
      updatedFeatures: ["matcher_provider_id", "ai_writing_provider_id"],
    });
    expect(storedSettings.get("matcher_provider_id")).toBe(fallback.id);
    expect(storedSettings.get("matcher_model")).toBe("fallback-model");
    expect(storedSettings.get("matcher_reasoning_effort")).toBe("medium");
    expect(storedSettings.get("ai_writing_provider_id")).toBe(fallback.id);
    expect(storedSettings.get("ai_writing_model")).toBe("fallback-model");
  });

  it("persists validated capability metadata and can reuse stale metadata for execution", async () => {
    const { database } = harness.createDatabase();
    const cache = createLocalCLICatalogCache(database);
    const fetchedAt = Date.now() - 60 * 60 * 1_000;
    await cache.save("opencode_cli", [{
      modelId: "openai/gpt",
      label: "GPT",
      description: "Synthetic model",
      supportsReasoning: true,
      reasoningControl: {
        kind: "effort",
        options: ["minimal", "xhigh", "max", "future_v1"].map((value) => ({ value })),
        defaultValue: "xhigh",
      },
      supportedReasoningEfforts: ["minimal", "xhigh", "max", "future_v1"],
      defaultReasoningEffort: "xhigh",
      upstreamProvider: "openai",
    }], fetchedAt);

    await expect(cache.load("opencode_cli")).resolves.toBeNull();
    await expect(cache.load("opencode_cli", { allowExpired: true })).resolves.toEqual({
      fetchedAt,
      models: [expect.objectContaining({
        modelId: "openai/gpt",
        supportedReasoningEfforts: ["minimal", "xhigh", "max", "future_v1"],
      })],
    });
    await cache.delete("opencode_cli");
    await expect(cache.load("opencode_cli", { allowExpired: true })).resolves.toBeNull();

    await expect(cache.save("codex_cli", [{
      modelId: "bad",
      label: "Bad",
      description: "",
      supportsReasoning: true,
      supportedReasoningEfforts: ["ultra"],
    // The cast verifies that repository validation, not TypeScript alone, protects JSON storage.
    }] as never)).rejects.toThrow();
  });

  it("bounds local CLI display metadata while preserving opaque reasoning values", async () => {
    const { database } = harness.createDatabase();
    const cache = createLocalCLICatalogCache(database);
    await cache.save("codex_cli", [{
      modelId: "future-model",
      label: "L".repeat(300),
      description: "D".repeat(2_500),
      supportsReasoning: true,
      reasoningControl: {
        kind: "effort",
        options: [{
          value: "future_v1",
          label: "R".repeat(150),
          description: "E".repeat(600),
        }],
        defaultValue: "future_v1",
      },
      supportedReasoningEfforts: ["future_v1"],
      defaultReasoningEffort: "future_v1",
    }]);

    const stored = await cache.load("codex_cli", { allowExpired: true });
    expect(stored?.models[0]?.label).toHaveLength(240);
    expect(stored?.models[0]?.description).toHaveLength(2_000);
    expect(stored?.models[0]?.reasoningControl).toEqual({
      kind: "effort",
      options: [{
        value: "future_v1",
        label: "R".repeat(120),
        description: "E".repeat(500),
      }],
      defaultValue: "future_v1",
    });
  });
});
