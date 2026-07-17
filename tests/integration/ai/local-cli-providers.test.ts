import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { asc, eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
import { migrateLocalDatabase } from "@/lib/db/migrations";
import { removeDeprecatedMatchingPreferenceSettings } from "@/lib/settings/settings-service";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-cli-providers-");
const legacyModelCapabilities = sqliteTable("ai_model_capabilities", {
  id: text("id").primaryKey(),
  providerRecordId: text("provider_record_id").notNull(),
  modelId: text("model_id").notNull(),
  backendVersion: text("backend_version").notNull(),
  probeVersion: text("probe_version").notNull(),
  textStatus: text("text_status").notNull(),
  streamingStatus: text("streaming_status").notNull(),
  nativeStructuredStatus: text("native_structured_status").notNull(),
  portableStructuredStatus: text("portable_structured_status").notNull(),
  checkedAt: integer("checked_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

function migrationsThrough(maxIndex: number): string {
  const source = join(process.cwd(), "drizzle");
  const destination = mkdtempSync(join(tmpdir(), "switchy-cli-provider-migrations-"));
  mkdirSync(join(destination, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(join(source, "meta", "_journal.json"), "utf8")
  ) as { entries: Array<{ idx: number; tag: string }> };
  const entries = journal.entries.filter((entry) => entry.idx <= maxIndex);
  for (const entry of entries) {
    cpSync(join(source, `${entry.tag}.sql`), join(destination, `${entry.tag}.sql`));
  }
  writeFileSync(
    join(destination, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries })
  );
  return destination;
}

describe("local CLI provider records", () => {
  it("drops obsolete capability certifications when upgrading from migration 22", () => {
    const { database } = harness.createDatabase({ migrate: false });
    const previousMigrations = migrationsThrough(22);
    try {
      migrateLocalDatabase(database, previousMigrations);
      database.insert(aiProviders).values({
        id: "provider-before-cleanup",
        provider: "openai",
        isActive: true,
        isDefault: true,
      }).run();
      database.insert(legacyModelCapabilities).values({
        id: "obsolete-certification",
        providerRecordId: "provider-before-cleanup",
        modelId: "test-model",
        backendVersion: "old-backend",
        probeVersion: "old-probe",
        textStatus: "supported",
        streamingStatus: "supported",
        nativeStructuredStatus: "failed",
        portableStructuredStatus: "supported",
        checkedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }).run();

      migrateLocalDatabase(database, join(process.cwd(), "drizzle"));

      expect(database.select().from(aiProviders)
        .where(eq(aiProviders.id, "provider-before-cleanup")).get()).toBeDefined();
      expect(() => database.select().from(legacyModelCapabilities).all())
        .toThrow(/no such table/i);
    } finally {
      rmSync(previousMigrations, { recursive: true, force: true });
    }
  });

  it("idempotently creates permanent deterministic CLI records without credentials", async () => {
    const { database } = harness.createDatabase();

    await listProviders(database);
    const firstUpdatedAt = database.select({
      id: aiProviders.id,
      updatedAt: aiProviders.updatedAt,
    }).from(aiProviders).orderBy(asc(aiProviders.id)).all();
    await listProviders(database);

    const providers = await database.select().from(aiProviders).orderBy(asc(aiProviders.id));
    expect(providers).toEqual([
      expect.objectContaining({
        id: "builtin:codex-cli",
        provider: "codex_cli",
        apiKey: null,
        isDefault: false,
        isActive: true,
      }),
      expect.objectContaining({
        id: "builtin:opencode-cli",
        provider: "opencode_cli",
        apiKey: null,
        isDefault: false,
        isActive: true,
      }),
    ]);
    expect(JSON.stringify(providers.map(toProviderPublic))).not.toContain("apiKey");
    expect(JSON.stringify(providers.map(toProviderPublic))).not.toContain("credential");
    await expect(createProvider({ provider: "codex_cli" }, database)).rejects.toThrow(
      "built in"
    );
    expect(database.select({
      id: aiProviders.id,
      updatedAt: aiProviders.updatedAt,
    }).from(aiProviders).orderBy(asc(aiProviders.id)).all()).toEqual(firstUpdatedAt);

    const apiProvider = await createProvider({ provider: "openai" }, database);
    expect(apiProvider.isDefault).toBe(true);
    await expect(deleteProvider("builtin:codex-cli", { database })).rejects.toThrow(
      "cannot be deleted"
    );
  });

  it("removes obsolete active matching preferences while preserving other settings", async () => {
    const { database } = harness.createDatabase();
    database.insert(settings).values([
      { key: "matcher_accepted_location_types", value: '["remote"]' },
      { key: "matcher_accepted_employment_types", value: '["full-time"]' },
      { key: "matcher_model", value: "kept-model" },
    ]).run();

    await removeDeprecatedMatchingPreferenceSettings(database);

    expect(database.select().from(settings).all()).toEqual([
      expect.objectContaining({ key: "matcher_model", value: "kept-model" }),
    ]);
  });

  it("migrates legacy random CLI records and feature references to built-in IDs", async () => {
    const { database } = harness.createDatabase();
    database.insert(aiProviders).values({
      id: "legacy-random-codex-id",
      provider: "codex_cli",
      apiKey: "must-not-survive",
      isActive: false,
      isDefault: true,
    }).run();
    database.insert(settings).values([
      { key: "matcher_provider_id", value: "legacy-random-codex-id" },
      {
        key: "provider_model_catalog:legacy-random-codex-id",
        value: "stale-catalog",
      },
    ]).run();

    await listProviders(database);

    expect(database.select().from(aiProviders)
      .where(eq(aiProviders.provider, "codex_cli")).all()).toEqual([
      expect.objectContaining({
        id: "builtin:codex-cli",
        apiKey: null,
        isActive: true,
        isDefault: false,
      }),
    ]);
    expect(database.select().from(settings)
      .where(eq(settings.key, "matcher_provider_id")).get()?.value)
      .toBe("builtin:codex-cli");
    expect(database.select().from(settings)
      .where(eq(settings.key, "provider_model_catalog:legacy-random-codex-id")).get())
      .toBeUndefined();
  });

  it("moves feature selections to an available provider and model when deleting one", async () => {
    const { database } = harness.createDatabase();
    const selected = database.insert(aiProviders).values({
      id: "11111111-1111-4111-8111-111111111111",
      provider: "openai",
      isActive: true,
      isDefault: true,
    }).returning().get();
    const fallback = database.insert(aiProviders).values({
      id: "22222222-2222-4222-8222-222222222222",
      provider: "anthropic",
      isActive: true,
      isDefault: false,
    }).returning().get();
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

  it("does not promote or silently select a built-in CLI when deleting the default API provider", async () => {
    const { database } = harness.createDatabase();
    await listProviders(database);
    const selected = await createProvider({ provider: "openai" }, database);
    database.insert(settings).values([
      { key: "matcher_provider_id", value: selected.id },
      { key: "matcher_model", value: "selected-model" },
      { key: "matcher_reasoning_effort", value: "high" },
    ]).run();
    const resolveModels = vi.fn().mockResolvedValue({
      models: [{
        modelId: "cli-model",
        label: "CLI model",
        description: "",
        supportsReasoning: false,
        reasoningControl: { kind: "provider_default" as const },
        supportedReasoningEfforts: [],
        isDefault: true,
      }],
    });

    const result = await deleteProvider(selected.id, {
      database,
      resolveModels,
      deleteModelsCache: vi.fn().mockResolvedValue(undefined),
    });

    expect(result).toEqual({
      fallbackProviderId: undefined,
      fallbackModelId: undefined,
      updatedFeatures: ["matcher_provider_id"],
    });
    expect(resolveModels).not.toHaveBeenCalled();
    expect(database.select().from(aiProviders).all().every((row) => !row.isDefault))
      .toBe(true);
    expect(database.select().from(settings)
      .where(eq(settings.key, "matcher_provider_id")).get()).toBeUndefined();
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
