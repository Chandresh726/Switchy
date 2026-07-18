import { rmSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/encryption", () => {
  const encrypt = (value: string) => `encrypted:${Buffer.from(value).toString("base64")}`;
  const decrypt = (value: string) => Buffer.from(value.slice("encrypted:".length), "base64").toString();
  return {
    encryptApiKey: encrypt,
    decryptApiKey: decrypt,
    encryptSecret: encrypt,
    decryptSecret: decrypt,
  };
});

import {
  createProvider,
  deleteProvider,
  toProviderPublic,
  updateProvider,
} from "@/lib/ai/providers/provider-service";
import type { ProviderCreateBody } from "@/lib/api/contracts/providers";
import { aiProviders, settings } from "@/lib/db/schema";
import { migrateLocalDatabase } from "@/lib/db/migrations";
import { createMigrationsThrough } from "@test/helpers/migrations";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-custom-providers-");
const legacyAiProviders = sqliteTable("aiProviders", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  apiKey: text("api_key"),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  isDefault: integer("is_default", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});
const discoveredModels = [{
  modelId: "proxy-model",
  label: "Proxy model",
  description: "",
  supportsReasoning: false,
  reasoningControl: { kind: "provider_default" as const },
}];

function customInput(name: string): ProviderCreateBody & { provider: "custom" } {
  return {
    provider: "custom" as const,
    displayName: name,
    apiFormat: "openai_chat_completions" as const,
    baseUrl: "http://127.0.0.1:8317/v1/",
    apiKey: "proxy-secret",
    headers: [{ name: "X-Account", value: `header-secret-${name}` }],
    manualModelIds: ["manual-model"],
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
  };
}

describe("custom provider persistence", () => {
  it("migrates existing providers with nullable custom fields", () => {
    const { database } = harness.createDatabase({ migrate: false });
    const previousMigrations = createMigrationsThrough(30, "switchy-custom-migrations-");
    try {
      migrateLocalDatabase(database, previousMigrations);
      database.insert(legacyAiProviders).values({
        id: "legacy-openai",
        provider: "openai",
        apiKey: null,
      }).run();

      migrateLocalDatabase(database, join(process.cwd(), "drizzle"));

      expect(database.select().from(aiProviders)
        .where(eq(aiProviders.id, "legacy-openai")).get()).toMatchObject({
        displayName: null,
        apiFormat: null,
        baseUrl: null,
        encryptedHeaders: null,
        manualModelIds: null,
        reasoningEfforts: null,
      });
    } finally {
      rmSync(previousMigrations, { recursive: true, force: true });
    }
  });

  it("adds atomic uniqueness for built-in providers while allowing custom instances", () => {
    const { database } = harness.createDatabase({ migrate: false });
    const previousMigrations = createMigrationsThrough(31, "switchy-provider-uniqueness-");
    try {
      migrateLocalDatabase(database, previousMigrations);
      database.insert(legacyAiProviders).values([
        { id: "preferred-openai", provider: "openai", isDefault: true },
        { id: "duplicate-openai", provider: "openai", isDefault: false },
        { id: "custom-one", provider: "custom" },
        { id: "custom-two", provider: "custom" },
      ]).run();
      database.insert(settings).values([
        { key: "matcher_provider_id", value: "duplicate-openai" },
        { key: "provider_model_catalog:duplicate-openai", value: "stale" },
      ]).run();

      migrateLocalDatabase(database, join(process.cwd(), "drizzle"));

      expect(database.select().from(aiProviders)
        .where(eq(aiProviders.provider, "openai")).all()).toEqual([
        expect.objectContaining({ id: "preferred-openai" }),
      ]);
      expect(database.select().from(settings)
        .where(eq(settings.key, "matcher_provider_id")).get()?.value).toBe("preferred-openai");
      expect(database.select().from(settings)
        .where(eq(settings.key, "provider_model_catalog:duplicate-openai")).get()).toBeUndefined();
      expect(() => database.insert(aiProviders).values({
        id: "new-duplicate-openai",
        provider: "openai",
      }).run()).toThrow();
      expect(() => database.insert(aiProviders).values({
        id: "custom-three",
        provider: "custom",
      }).run()).not.toThrow();
    } finally {
      rmSync(previousMigrations, { recursive: true, force: true });
    }
  });

  it("stores multiple named custom providers with encrypted secrets and sanitized public data", async () => {
    const { database } = harness.createDatabase();
    const discoverCustomModels = vi.fn().mockResolvedValue(discoveredModels);
    const first = await createProvider(customInput("Primary proxy"), database, { discoverCustomModels });
    const second = await createProvider(customInput("Backup proxy"), database, { discoverCustomModels });

    expect(first.id).not.toBe(second.id);
    expect(discoverCustomModels).toHaveBeenCalledTimes(2);
    expect(first.baseUrl).toBe("http://127.0.0.1:8317/v1");
    expect(first.apiKey).not.toContain("proxy-secret");
    expect(first.encryptedHeaders).not.toContain("header-secret-Primary proxy");

    const publicProvider = toProviderPublic(first);
    expect(publicProvider).toMatchObject({
      displayName: "Primary proxy",
      apiFormat: "openai_chat_completions",
      baseUrl: "http://127.0.0.1:8317/v1",
      headerNames: ["X-Account"],
      manualModelIds: ["manual-model"],
      reasoningEfforts: ["low", "medium", "high", "xhigh"],
      hasApiKey: true,
      kind: "custom",
    });
    expect(JSON.stringify(publicProvider)).not.toContain("proxy-secret");
    expect(JSON.stringify(publicProvider)).not.toContain("header-secret-Primary proxy");
  });

  it("preserves secret fields on omission and leaves a working config unchanged after failed validation", async () => {
    const { database } = harness.createDatabase();
    const provider = await createProvider(customInput("Primary proxy"), database, {
      discoverCustomModels: vi.fn().mockResolvedValue(discoveredModels),
    });
    database.insert(settings).values({
      key: `provider_model_catalog:${provider.id}`,
      value: "stale-catalog",
    }).run();
    const before = database.select().from(aiProviders).where(eq(aiProviders.id, provider.id)).get()!;

    await updateProvider(provider.id, {
      displayName: "Renamed proxy",
      headers: [{ name: "X-Account" }],
    }, database, {
      discoverCustomModels: vi.fn().mockResolvedValue(discoveredModels),
    });
    const updated = database.select().from(aiProviders).where(eq(aiProviders.id, provider.id)).get()!;
    expect(updated.apiKey).not.toBeNull();
    expect(toProviderPublic(updated).headerNames).toEqual(["X-Account"]);
    expect(database.select().from(settings)
      .where(eq(settings.key, `provider_model_catalog:${provider.id}`)).get())
      .toBeUndefined();

    await expect(updateProvider(provider.id, {
      baseUrl: "https://unavailable.example/v1",
      headers: [],
    }, database, {
      discoverCustomModels: vi.fn().mockRejectedValue(new Error("unavailable")),
    })).rejects.toThrow("unavailable");

    const afterFailure = database.select().from(aiProviders).where(eq(aiProviders.id, provider.id)).get()!;
    expect(afterFailure.baseUrl).toBe(updated.baseUrl);
    expect(afterFailure.encryptedHeaders).toBe(updated.encryptedHeaders);
    expect(afterFailure.apiKey).toBe(updated.apiKey);
    expect(afterFailure.apiKey).toBe(before.apiKey);

    await updateProvider(provider.id, {
      apiKey: null,
      headers: [],
    }, database, {
      discoverCustomModels: vi.fn().mockResolvedValue(discoveredModels),
    });
    const cleared = database.select().from(aiProviders).where(eq(aiProviders.id, provider.id)).get()!;
    expect(cleared.apiKey).toBeNull();
    expect(cleared.encryptedHeaders).toBeNull();
  });

  it("updates a custom provider display name without discovery or cache invalidation", async () => {
    const { database } = harness.createDatabase();
    const provider = await createProvider(customInput("Primary proxy"), database, {
      discoverCustomModels: vi.fn().mockResolvedValue(discoveredModels),
    });
    const discoverCustomModels = vi.fn().mockRejectedValue(new Error("endpoint unavailable"));
    const deleteModelsCache = vi.fn().mockRejectedValue(new Error("cache unavailable"));

    await updateProvider(provider.id, { displayName: "Renamed proxy" }, database, {
      discoverCustomModels,
      deleteModelsCache,
    });

    expect(discoverCustomModels).not.toHaveBeenCalled();
    expect(deleteModelsCache).not.toHaveBeenCalled();
    expect(database.select().from(aiProviders)
      .where(eq(aiProviders.id, provider.id)).get()?.displayName).toBe("Renamed proxy");
  });

  it("updates manual models offline while invalidating the cached catalog", async () => {
    const { database } = harness.createDatabase();
    const provider = await createProvider(customInput("Primary proxy"), database, {
      discoverCustomModels: vi.fn().mockResolvedValue(discoveredModels),
    });
    const discoverCustomModels = vi.fn().mockRejectedValue(new Error("endpoint unavailable"));
    const deleteModelsCache = vi.fn().mockResolvedValue(undefined);

    await updateProvider(provider.id, { manualModelIds: ["offline-model"] }, database, {
      discoverCustomModels,
      deleteModelsCache,
    });

    expect(discoverCustomModels).not.toHaveBeenCalled();
    expect(deleteModelsCache).toHaveBeenCalledWith(provider.id, database);
    expect(toProviderPublic(database.select().from(aiProviders)
      .where(eq(aiProviders.id, provider.id)).get()!).manualModelIds).toEqual(["offline-model"]);
  });

  it("does not replace a working connection when cache invalidation fails", async () => {
    const { database } = harness.createDatabase();
    const provider = await createProvider(customInput("Primary proxy"), database, {
      discoverCustomModels: vi.fn().mockResolvedValue(discoveredModels),
    });
    const before = database.select().from(aiProviders)
      .where(eq(aiProviders.id, provider.id)).get()!;

    await expect(updateProvider(provider.id, {
      baseUrl: "https://replacement.example/v1",
    }, database, {
      discoverCustomModels: vi.fn().mockResolvedValue(discoveredModels),
      deleteModelsCache: vi.fn().mockRejectedValue(new Error("cache unavailable")),
    })).rejects.toThrow("cache unavailable");

    const after = database.select().from(aiProviders)
      .where(eq(aiProviders.id, provider.id)).get()!;
    expect(after).toEqual(before);
  });

  it("does not delete a provider when cache invalidation fails", async () => {
    const { database } = harness.createDatabase();
    const provider = await createProvider(customInput("Primary proxy"), database, {
      discoverCustomModels: vi.fn().mockResolvedValue(discoveredModels),
    });

    await expect(deleteProvider(provider.id, {
      database,
      deleteModelsCache: vi.fn().mockRejectedValue(new Error("cache unavailable")),
    })).rejects.toThrow("cache unavailable");

    expect(database.select().from(aiProviders)
      .where(eq(aiProviders.id, provider.id)).get()).toBeDefined();
  });

  it("falls back to another custom provider when a selected custom provider is deleted", async () => {
    const { database } = harness.createDatabase();
    const discoverCustomModels = vi.fn().mockResolvedValue(discoveredModels);
    const selected = await createProvider(customInput("Selected"), database, { discoverCustomModels });
    const fallback = await createProvider(customInput("Fallback"), database, { discoverCustomModels });
    database.insert(settings).values([
      { key: "matcher_provider_id", value: selected.id },
      { key: "matcher_model", value: "old-model" },
      { key: "matcher_reasoning_effort", value: "" },
    ]).run();

    const result = await deleteProvider(selected.id, {
      database,
      resolveModels: vi.fn().mockResolvedValue({ models: discoveredModels }),
      deleteModelsCache: vi.fn().mockResolvedValue(undefined),
    });

    expect(result).toMatchObject({
      fallbackProviderId: fallback.id,
      fallbackModelId: "proxy-model",
      updatedFeatures: ["matcher_provider_id"],
    });
    expect(database.select().from(settings).where(eq(settings.key, "matcher_provider_id")).get()?.value)
      .toBe(fallback.id);
  });
});
