import "server-only";

import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { z } from "zod";

import { db } from "@/lib/db";
import { aiProviders, settings } from "@/lib/db/schema";
import type * as databaseSchema from "@/lib/db/schema";
import { decryptApiKey } from "@/lib/encryption";
import { AIError } from "@/lib/ai/shared/errors";
import { getLocalCLIModelCatalog } from "@/lib/ai/local-cli/service";
import { loadStoredLocalCLICatalog } from "@/lib/ai/local-cli/catalog-cache";

import { resolveStoredCustomProvider } from "../custom-config";
import { connectionStatusRepository } from "../connections/repository";
import { isAIProvider, isLocalCLIProvider } from "../types";
import { ProviderModelDefinitionSchema, type ProviderModelDefinition } from "../model-contract";
import { discoverProviderModels } from "./discovery";
import type { GetProviderModelsOptions, ProviderModelsResponse, ResolvedProviderCatalogRecord } from "./types";

export type { ProviderModelDefinition } from "../model-contract";
export type { ProviderModelsResponse, ResolvedProviderCatalogRecord } from "./types";
export { discoverCustomProviderModels } from "./discovery";

const MODEL_CACHE_TTL_MS = 15 * 60 * 1000;
const MODEL_CATALOG_SCHEMA_VERSION = 2;

interface CachedProviderModels {
  providerUpdatedAtMs: number;
  models: ProviderModelDefinition[];
  fetchedAt: string;
  expiresAt: number;
}

const catalogFlights = new Map<string, Promise<ProviderModelDefinition[]>>();
const providerModelCache = new Map<string, CachedProviderModels>();
const StoredProviderCatalogSchema = z.object({
  schemaVersion: z.literal(MODEL_CATALOG_SCHEMA_VERSION),
  providerUpdatedAtMs: z.number().int().nonnegative(),
  fetchedAt: z.string().datetime(),
  models: z.array(ProviderModelDefinitionSchema).max(1_000),
}).strict();

function catalogSettingKey(providerId: string): string {
  return `provider_model_catalog:${providerId}`;
}

async function getProviderRecord(providerId: string): Promise<ResolvedProviderCatalogRecord> {
  const result = await db
    .select()
    .from(aiProviders)
    .where(and(eq(aiProviders.id, providerId), eq(aiProviders.isActive, true)))
    .limit(1);

  const provider = result[0];
  if (!provider) {
    throw new AIError({
      type: "provider_not_found",
      message: `Provider "${providerId}" not found`,
    });
  }

  if (!isAIProvider(provider.provider)) {
    throw new AIError({
      type: "provider_not_found",
      message: `Provider "${provider.provider}" is not supported`,
    });
  }

  let decryptedApiKey: string | undefined;
  if (provider.apiKey) {
    try {
      decryptedApiKey = decryptApiKey(provider.apiKey);
    } catch (error) {
      throw new AIError({
        type: "decryption_failed",
        message: `Failed to decrypt API key for provider "${provider.provider}"`,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  return {
    id: provider.id,
    provider: provider.provider,
    apiKey: decryptedApiKey,
    updatedAt: provider.updatedAt,
    customConnection: provider.provider === "custom"
      ? resolveStoredCustomProvider(provider, decryptedApiKey)
      : undefined,
  };
}

function getProviderUpdatedAtMs(provider: { updatedAt: Date | null }): number {
  return provider.updatedAt?.getTime() ?? 0;
}

function getCacheEntry(provider: ResolvedProviderCatalogRecord): CachedProviderModels | null {
  const entry = providerModelCache.get(provider.id);
  if (!entry) {
    return null;
  }

  if (entry.providerUpdatedAtMs !== getProviderUpdatedAtMs(provider)) {
    providerModelCache.delete(provider.id);
    return null;
  }

  return entry;
}

async function loadStoredCacheEntry(
  provider: Pick<ResolvedProviderCatalogRecord, "id" | "updatedAt">
): Promise<CachedProviderModels | null> {
  const row = await db.select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, catalogSettingKey(provider.id)))
    .limit(1);
  if (!row[0]?.value) return null;

  try {
    const stored = StoredProviderCatalogSchema.parse(JSON.parse(row[0].value));
    if (stored.providerUpdatedAtMs !== getProviderUpdatedAtMs(provider)) {
      return null;
    }
    const fetchedAtMs = Date.parse(stored.fetchedAt);
    return {
      ...stored,
      expiresAt: fetchedAtMs + MODEL_CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

async function saveStoredCacheEntry(
  provider: ResolvedProviderCatalogRecord,
  entry: CachedProviderModels
): Promise<void> {
  const value = JSON.stringify(StoredProviderCatalogSchema.parse({
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    providerUpdatedAtMs: entry.providerUpdatedAtMs,
    fetchedAt: entry.fetchedAt,
    models: entry.models,
  }));
  await db.insert(settings).values({
    key: catalogSettingKey(provider.id),
    value,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: settings.key,
    set: { value, updatedAt: new Date() },
  });
}

function buildResponse(
  provider: ResolvedProviderCatalogRecord,
  cacheEntry: CachedProviderModels,
  source: "live" | "cache",
  isStale: boolean,
  warning?: string
): ProviderModelsResponse {
  return {
    providerId: provider.id,
    provider: provider.provider,
    models: cacheEntry.models,
    fetchedAt: cacheEntry.fetchedAt,
    isStale,
    source,
    warning,
  };
}

export async function getProviderModels(
  providerId: string,
  options: GetProviderModelsOptions = {}
): Promise<ProviderModelsResponse> {
  const provider = await getProviderRecord(providerId);
  return getProviderModelsForResolvedProvider(provider, options);
}

export async function getProviderModelsForResolvedProvider(
  provider: ResolvedProviderCatalogRecord,
  options: GetProviderModelsOptions = {}
): Promise<ProviderModelsResponse> {
  if (isLocalCLIProvider(provider.provider)) {
    const catalog = await getLocalCLIModelCatalog(provider.provider, options);
    return { providerId: provider.id, provider: provider.provider, ...catalog };
  }
  const now = Date.now();
  let cacheEntry = getCacheEntry(provider);
  if (!cacheEntry) {
    cacheEntry = await loadStoredCacheEntry(provider);
    if (cacheEntry) providerModelCache.set(provider.id, cacheEntry);
  }

  if (!options.forceRefresh && cacheEntry && (cacheEntry.expiresAt > now || options.preferCache)) {
    return buildResponse(provider, cacheEntry, "cache", cacheEntry.expiresAt <= now);
  }

  return refreshProviderCatalog(provider, cacheEntry, options);
}

async function discoverShared(provider: ResolvedProviderCatalogRecord): Promise<ProviderModelDefinition[]> {
  const flightKey = `${provider.id}:${getProviderUpdatedAtMs(provider)}`;
  const existing = catalogFlights.get(flightKey);
  if (existing) return existing;
  const flight = discoverProviderModels(provider);
  catalogFlights.set(flightKey, flight);
  try {
    return await flight;
  } finally {
    if (catalogFlights.get(flightKey) === flight) catalogFlights.delete(flightKey);
  }
}

async function refreshProviderCatalog(
  provider: ResolvedProviderCatalogRecord,
  cacheEntry: CachedProviderModels | null,
  options: GetProviderModelsOptions
): Promise<ProviderModelsResponse> {
  const now = Date.now();
  try {
    const discoveredModels = await discoverShared(provider);
    const models = z.array(ProviderModelDefinitionSchema).max(1_000).parse(discoveredModels);
    if (models.length === 0) {
      throw new AIError({
        type: "invalid_model",
        message: `No supported text/chat models found for provider "${provider.provider}"`,
      });
    }

    const freshEntry: CachedProviderModels = {
      providerUpdatedAtMs: getProviderUpdatedAtMs(provider),
      models,
      fetchedAt: new Date().toISOString(),
      expiresAt: now + MODEL_CACHE_TTL_MS,
    };

    providerModelCache.set(provider.id, freshEntry);
    await saveStoredCacheEntry(provider, freshEntry);
    await connectionStatusRepository.save(provider.id, {
      status: "ready", selectable: true,
      statusMessage: provider.customConnection?.modelDiscovery === "manual"
        ? "Manual model catalog configured. Use inference to verify model access."
        : "Model catalog verified. Individual model access may vary.",
      lastCheckedAt: freshEntry.fetchedAt,
    }, getProviderUpdatedAtMs(provider));

    return buildResponse(provider, freshEntry, "live", false);
  } catch (error) {
    await connectionStatusRepository.save(provider.id, {
      status: error instanceof AIError && [401, 403].includes(Number(error.context?.status))
        ? "not_authenticated" : "error",
      selectable: false,
      statusMessage: "Could not verify the provider model catalog. Check the connection and try again.",
      lastCheckedAt: new Date().toISOString(),
    }, getProviderUpdatedAtMs(provider));
    if (cacheEntry && options.allowStaleOnError !== false) {
      const warning = error instanceof Error ? error.message : "Failed to refresh provider models";
      return buildResponse(provider, cacheEntry, "cache", true, warning);
    }

    throw error;
  }
}

export async function getCachedProviderModelDefinition(
  providerId: string,
  modelId: string
): Promise<ProviderModelDefinition | null> {
  const row = await db.select({
    id: aiProviders.id,
    updatedAt: aiProviders.updatedAt,
    provider: aiProviders.provider,
  }).from(aiProviders).where(and(
    eq(aiProviders.id, providerId),
    eq(aiProviders.isActive, true)
  )).limit(1);
  const provider = row[0];
  if (!provider) return null;
  if (isLocalCLIProvider(provider.provider)) {
    const catalog = await loadStoredLocalCLICatalog(provider.provider, { allowExpired: true });
    return catalog?.models.find((model) => model.modelId === modelId) ?? null;
  }

  let entry = providerModelCache.get(provider.id) ?? null;
  if (entry?.providerUpdatedAtMs !== getProviderUpdatedAtMs(provider)) {
    entry = null;
  }
  if (!entry) {
    entry = await loadStoredCacheEntry(provider);
    if (entry) providerModelCache.set(provider.id, entry);
  }

  return entry?.models.find((model) => model.modelId === modelId) ?? null;
}

export async function deleteStoredProviderModelsCache(
  providerId: string,
  database: BetterSQLite3Database<typeof databaseSchema> = db
): Promise<void> {
  clearProviderModelsCache(providerId);
  await database.delete(settings).where(eq(settings.key, catalogSettingKey(providerId)));
}

export function clearProviderModelsCache(providerId?: string): void {
  if (providerId) {
    providerModelCache.delete(providerId);
    return;
  }

  providerModelCache.clear();
}
