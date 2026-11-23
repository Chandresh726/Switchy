import { eq } from "drizzle-orm";
import { z } from "zod";

import { CLI_MODEL_CACHE_TTL_MS } from "@/lib/ai/local-cli/constants";
import { ProviderModelDefinitionSchema, type ProviderModelDefinition } from "@/lib/ai/providers/model-contract";
import type { LocalCLIProvider } from "@/lib/ai/providers/types";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

const StoredCatalogSchema = z.object({
  fetchedAt: z.number().int().nonnegative(),
  models: z.array(ProviderModelDefinitionSchema).max(1_000),
}).strict();

interface StoredLocalCLICatalog {
  fetchedAt: number;
  models: ProviderModelDefinition[];
}

export function validateLocalCLIModelCatalog(
  models: ProviderModelDefinition[]
): ProviderModelDefinition[] {
  return z.array(ProviderModelDefinitionSchema).max(1_000).parse(models);
}

function settingKey(provider: LocalCLIProvider): string {
  return `local_cli_model_catalog:${provider}`;
}

export function createLocalCLICatalogCache(database: typeof db) {
  return {
    async load(
      provider: LocalCLIProvider,
      options: { allowExpired?: boolean } = {}
    ): Promise<StoredLocalCLICatalog | null> {
      const row = await database.select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, settingKey(provider)))
        .limit(1);
      if (!row[0]?.value) return null;

      try {
        const catalog = StoredCatalogSchema.parse(JSON.parse(row[0].value));
        if (!options.allowExpired && catalog.fetchedAt + CLI_MODEL_CACHE_TTL_MS <= Date.now()) {
          return null;
        }
        return catalog;
      } catch {
        return null;
      }
    },

    async save(
      provider: LocalCLIProvider,
      models: ProviderModelDefinition[],
      fetchedAt = Date.now()
    ): Promise<void> {
      const validatedModels = validateLocalCLIModelCatalog(models);
      const value = JSON.stringify(StoredCatalogSchema.parse({
        fetchedAt,
        models: validatedModels,
      }));
      await database.insert(settings).values({
        key: settingKey(provider),
        value,
        updatedAt: new Date(fetchedAt),
      }).onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date(fetchedAt) },
      });
    },

    async delete(provider: LocalCLIProvider): Promise<void> {
      await database.delete(settings).where(eq(settings.key, settingKey(provider)));
    },
  };
}

const localCLICatalogCache = createLocalCLICatalogCache(db);

export const loadStoredLocalCLICatalog = localCLICatalogCache.load;
export const saveStoredLocalCLICatalog = localCLICatalogCache.save;
export const deleteStoredLocalCLICatalog = localCLICatalogCache.delete;
