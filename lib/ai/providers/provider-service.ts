import { randomUUID } from "crypto";

import { asc, desc, eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { AIError } from "@/lib/ai/shared/errors";
import { db } from "@/lib/db";
import { aiProviders, settings } from "@/lib/db/schema";
import type * as databaseSchema from "@/lib/db/schema";
import { decryptApiKey, encryptApiKey } from "@/lib/encryption";

import {
  deleteStoredProviderModelsCache,
  getProviderModels,
  type ProviderModelsResponse,
} from "./model-catalog";
import { getProviderMetadata } from "./metadata";
import { providerRegistry } from "./index";
import {
  isAIProvider,
  isLocalCLIProvider,
  type AIProvider,
  type LocalCLIProvider,
} from "./types";

export type ProviderRecord = typeof aiProviders.$inferSelect;

export interface ProviderPublic {
  id: string;
  provider: string;
  isActive: boolean | null;
  isDefault: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  hasApiKey: boolean;
  kind: "api_key" | "local_cli";
  selectable: boolean;
}

export interface ProviderValidationContext {
  provider: ProviderRecord;
  providerType: AIProvider;
  decryptedApiKey?: string;
}

export function toProviderPublic(record: ProviderRecord): ProviderPublic {
  return {
    id: record.id,
    provider: record.provider,
    isActive: record.isActive,
    isDefault: record.isDefault,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    hasApiKey: !!record.apiKey,
    kind: isAIProvider(record.provider)
      ? getProviderMetadata(record.provider).kind
      : "api_key",
    selectable: record.isActive !== false && !isLocalCLIProvider(record.provider),
  };
}

export async function listProviders(
  database: BetterSQLite3Database<typeof databaseSchema> = db
): Promise<ProviderRecord[]> {
  return database.select().from(aiProviders).orderBy(aiProviders.createdAt);
}

export async function getProviderById(
  providerId: string,
  database: BetterSQLite3Database<typeof databaseSchema> = db
): Promise<ProviderRecord | null> {
  const result = await database
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.id, providerId))
    .limit(1);
  return result[0] ?? null;
}

const FEATURE_PROVIDER_SETTINGS = [
  {
    provider: "matcher_provider_id",
    model: "matcher_model",
    effort: "matcher_reasoning_effort",
  },
  {
    provider: "resume_parser_provider_id",
    model: "resume_parser_model",
    effort: "resume_parser_reasoning_effort",
  },
  {
    provider: "ai_writing_provider_id",
    model: "ai_writing_model",
    effort: "ai_writing_reasoning_effort",
  },
] as const;

interface DeleteProviderOptions {
  database?: BetterSQLite3Database<typeof databaseSchema>;
  resolveModels?: (providerId: string) => Promise<Pick<ProviderModelsResponse, "models">>;
  deleteModelsCache?: (providerId: string) => Promise<void>;
  resetLocalProvider?: (provider: LocalCLIProvider) => Promise<void>;
}

export interface ProviderDeletionResult {
  fallbackProviderId?: string;
  fallbackModelId?: string;
  updatedFeatures: string[];
}

export async function requireProviderById(
  providerId: string,
  database: BetterSQLite3Database<typeof databaseSchema> = db
): Promise<ProviderRecord> {
  const provider = await getProviderById(providerId, database);
  if (!provider) {
    throw new AIError({
      type: "provider_not_found",
      message: "Provider not found",
      context: { providerId },
    });
  }
  return provider;
}

export function decryptProviderApiKey(provider: ProviderRecord): string | undefined {
  if (!provider.apiKey) {
    return undefined;
  }

  try {
    return decryptApiKey(provider.apiKey);
  } catch (error) {
    throw new AIError({
      type: "decryption_failed",
      message: "Failed to decrypt provider API key",
      cause: error instanceof Error ? error : undefined,
      context: { providerId: provider.id, provider: provider.provider },
    });
  }
}

export async function createProvider(options: {
  provider: AIProvider;
  apiKey?: string;
}, database: BetterSQLite3Database<typeof databaseSchema> = db): Promise<ProviderRecord> {
  const existing = await database
    .select({ id: aiProviders.id })
    .from(aiProviders)
    .where(eq(aiProviders.provider, options.provider))
    .limit(1);
  if (existing.length > 0) {
    throw new AIError({
      type: "validation",
      message: "This provider has already been added",
    });
  }

  const allProviders = await database.select().from(aiProviders);
  const isFirstProvider = allProviders.length === 0;
  const encryptedApiKey = !isLocalCLIProvider(options.provider) && options.apiKey?.trim()
    ? encryptApiKey(options.apiKey.trim())
    : undefined;

  const created = await database
    .insert(aiProviders)
    .values({
      id: randomUUID(),
      provider: options.provider,
      apiKey: encryptedApiKey,
      isActive: true,
      isDefault: isFirstProvider,
      updatedAt: new Date(),
    })
    .returning();

  return created[0];
}

export async function updateProviderApiKey(
  providerId: string,
  apiKey?: string | null
): Promise<void> {
  const provider = await requireProviderById(providerId);
  if (isLocalCLIProvider(provider.provider)) {
    throw new AIError({
      type: "validation",
      message: "Local CLI providers do not store API keys",
    });
  }
  const normalized = apiKey?.trim();
  const encryptedApiKey = normalized ? encryptApiKey(normalized) : null;

  await db
    .update(aiProviders)
    .set({
      apiKey: encryptedApiKey,
      updatedAt: new Date(),
    })
    .where(eq(aiProviders.id, providerId));

  await deleteStoredProviderModelsCache(providerId);
}

export async function deleteProvider(
  providerId: string,
  options: DeleteProviderOptions = {}
): Promise<ProviderDeletionResult> {
  const database = options.database ?? db;
  const resolveModels = options.resolveModels ?? getProviderModels;
  const deleteModelsCache = options.deleteModelsCache ?? deleteStoredProviderModelsCache;
  const provider = await requireProviderById(providerId, database);
  const providerSettingKeys = FEATURE_PROVIDER_SETTINGS.map(({ provider: key }) => key);
  const storedProviderSelections = await database
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, providerSettingKeys));
  const selectedProviderByFeature = new Map(
    storedProviderSelections.map(({ key, value }) => [key, value])
  );
  const impactedFeatures = FEATURE_PROVIDER_SETTINGS.filter(
    ({ provider: key }) => selectedProviderByFeature.get(key) === providerId
  );
  const remaining = await database
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.isActive, true))
    .orderBy(desc(aiProviders.isDefault), asc(aiProviders.createdAt));
  const candidates = remaining.filter(({ id }) => id !== providerId);

  let fallback: {
    providerId: string;
    modelId: string;
    reasoningEffort: string;
  } | null = null;
  if (impactedFeatures.length > 0) {
    for (const candidate of candidates) {
      try {
        const { models } = await resolveModels(candidate.id);
        const model = models.find(({ isDefault }) => isDefault) ?? models[0];
        if (!model) continue;
        fallback = {
          providerId: candidate.id,
          modelId: model.modelId,
          reasoningEffort: model.reasoningControl.kind === "effort"
            ? model.reasoningControl.defaultValue ?? model.reasoningControl.options[0]?.value ?? ""
            : "",
        };
        break;
      } catch {
        // Try the next configured provider when this one cannot supply models.
      }
    }
  }

  await database.delete(aiProviders).where(eq(aiProviders.id, providerId));
  await deleteModelsCache(providerId);
  if (isLocalCLIProvider(provider.provider)) {
    if (options.resetLocalProvider) {
      await options.resetLocalProvider(provider.provider);
    } else {
      const { resetLocalCLIProvider } = await import("@/lib/ai/local-cli/service");
      await resetLocalCLIProvider(provider.provider);
    }
  }

  if (provider.isDefault && candidates.length > 0) {
    const defaultProviderId = fallback?.providerId ?? candidates[0].id;
    await database
      .update(aiProviders)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(aiProviders.isActive, true));
    await database
      .update(aiProviders)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(aiProviders.id, defaultProviderId));
  }

  if (impactedFeatures.length > 0) {
    const impactedSettingKeys = impactedFeatures.flatMap(({ provider: providerKey, model, effort }) => [
      providerKey,
      model,
      effort,
    ]);
    if (!fallback) {
      await database.delete(settings).where(inArray(settings.key, impactedSettingKeys));
    } else {
      const now = new Date();
      const updates = impactedFeatures.flatMap(({ provider: providerKey, model, effort }) => [
        { key: providerKey, value: fallback.providerId, updatedAt: now },
        { key: model, value: fallback.modelId, updatedAt: now },
        { key: effort, value: fallback.reasoningEffort, updatedAt: now },
      ]);
      for (const update of updates) {
        await database.insert(settings).values(update).onConflictDoUpdate({
          target: settings.key,
          set: { value: update.value, updatedAt: now },
        });
      }
    }
  }

  return {
    fallbackProviderId: fallback?.providerId,
    fallbackModelId: fallback?.modelId,
    updatedFeatures: impactedFeatures.map(({ provider: key }) => key),
  };
}

export async function getProviderValidationContext(
  providerId: string
): Promise<ProviderValidationContext> {
  const provider = await requireProviderById(providerId);

  if (!isAIProvider(provider.provider)) {
    throw new AIError({
      type: "provider_not_found",
      message: "Provider is not registered",
      context: { providerId, provider: provider.provider },
    });
  }

  if (!isLocalCLIProvider(provider.provider) && !providerRegistry.get(provider.provider)) {
    throw new AIError({
      type: "provider_not_found",
      message: "Provider is not registered",
      context: { providerId, provider: provider.provider },
    });
  }

  return {
    provider,
    providerType: provider.provider,
    decryptedApiKey: decryptProviderApiKey(provider),
  };
}
