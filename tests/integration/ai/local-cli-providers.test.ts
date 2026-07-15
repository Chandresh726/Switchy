import { asc } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BUILTIN_CLI_PROVIDER_IDS } from "@/lib/ai/local-cli/constants";
import { createLocalCLICatalogCache } from "@/lib/ai/local-cli/catalog-cache";
import {
  ensureBuiltinCLIProviders,
  toProviderPublic,
} from "@/lib/ai/providers/provider-service";
import { aiProviders } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-cli-providers-");

describe("built-in local CLI provider records", () => {
  it("creates deterministic non-default keyless records idempotently", async () => {
    const { database } = harness.createDatabase();

    await ensureBuiltinCLIProviders(database);
    await ensureBuiltinCLIProviders(database);

    const providers = await database
      .select()
      .from(aiProviders)
      .orderBy(asc(aiProviders.id));
    expect(providers).toHaveLength(2);
    expect(providers).toEqual([
      expect.objectContaining({
        id: BUILTIN_CLI_PROVIDER_IDS.codex_cli,
        provider: "codex_cli",
        apiKey: null,
        isDefault: false,
        isActive: true,
      }),
      expect.objectContaining({
        id: BUILTIN_CLI_PROVIDER_IDS.opencode_cli,
        provider: "opencode_cli",
        apiKey: null,
        isDefault: false,
        isActive: true,
      }),
    ]);
    expect(JSON.stringify(providers.map(toProviderPublic))).not.toContain("apiKey");
    expect(JSON.stringify(providers.map(toProviderPublic))).not.toContain("credential");
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
