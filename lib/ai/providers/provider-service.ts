import { randomUUID } from "crypto";

import { asc, desc, eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { AIError } from "@/lib/ai/shared/errors";
import {
  BUILTIN_CLI_PROVIDER_IDS,
  CLI_EXECUTABLE_CONFIG,
} from "@/lib/ai/local-cli/constants";
import { retireLocalCLIProvider } from "@/lib/ai/local-cli/service";
import { db } from "@/lib/db";
import {
  aiProviders,
  aiRuns,
  settings,
} from "@/lib/db/schema";
import type * as databaseSchema from "@/lib/db/schema";
import { decryptApiKey, encryptApiKey } from "@/lib/encryption";
import type {
  ProviderCreateBody,
  ProviderPatchBody,
} from "@/lib/api/contracts/providers";

import {
  deleteStoredProviderModelsCache,
  discoverCustomProviderModels,
  getProviderModels,
  type ProviderModelsResponse,
} from "./model-catalog";
import { getProviderMetadata } from "./metadata";
import { providerRegistry } from "./index";
import {
  encryptCustomHeaders,
  mergeCustomHeaderPatch,
  normalizeCustomBaseUrl,
  normalizeCustomDisplayName,
  normalizeCustomHeaders,
  normalizeCustomReasoningEfforts,
  normalizeManualModelIds,
  resolveStoredCustomProvider,
  type CustomProviderConnection,
} from "./custom-config";
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
  kind: "api_key" | "local_cli" | "custom";
  selectable: boolean;
  displayName?: string;
  apiFormat?: CustomProviderConnection["apiFormat"];
  baseUrl?: string;
  headerNames?: string[];
  manualModelIds?: string[];
  reasoningEfforts?: string[];
}

export interface ProviderValidationContext {
  provider: ProviderRecord;
  providerType: AIProvider;
  decryptedApiKey?: string;
}

export function toProviderPublic(record: ProviderRecord): ProviderPublic {
  const custom = record.provider === "custom"
    ? resolveStoredCustomProvider(record)
    : undefined;
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
    ...(custom
      ? {
          displayName: custom.displayName,
          apiFormat: custom.apiFormat,
          baseUrl: custom.baseUrl,
          headerNames: Object.keys(custom.headers),
          manualModelIds: custom.manualModelIds,
          reasoningEfforts: custom.reasoningEfforts,
        }
      : {}),
  };
}

export async function listProviders(
  database: BetterSQLite3Database<typeof databaseSchema> = db
): Promise<ProviderRecord[]> {
  await reconcileConfiguredLocalCLIProviders(database);
  return database.select().from(aiProviders).orderBy(aiProviders.createdAt);
}

export async function reconcileConfiguredLocalCLIProviders(
  database: BetterSQLite3Database<typeof databaseSchema> = db
): Promise<LocalCLIProvider[]> {
  database.transaction((tx) => {
    for (const provider of ["codex_cli", "opencode_cli"] as const) {
      const builtinId = BUILTIN_CLI_PROVIDER_IDS[provider];
      const existing = tx.select().from(aiProviders)
        .where(eq(aiProviders.provider, provider)).all();
      if (existing.length === 0) continue;
      let builtin = existing.find(({ id }) => id === builtinId);
      const preferred = builtin ?? existing.find(({ isDefault }) => isDefault) ?? existing[0]!;

      for (const legacy of existing.filter(({ id }) => id !== builtinId)) {
        tx.update(settings).set({ value: builtinId })
          .where(eq(settings.value, legacy.id)).run();
        tx.delete(settings)
          .where(eq(settings.key, `provider_model_catalog:${legacy.id}`)).run();
        tx.update(aiRuns).set({ providerRecordId: builtinId })
          .where(eq(aiRuns.providerRecordId, legacy.id)).run();
        tx.delete(aiProviders).where(eq(aiProviders.id, legacy.id)).run();
      }

      if (!builtin) {
        builtin = tx.insert(aiProviders).values({
          id: builtinId,
          provider,
          apiKey: null,
          isActive: true,
          isDefault: preferred.isDefault,
          createdAt: preferred.createdAt,
          updatedAt: new Date(),
        }).returning().get();
      }

      if (
        builtin.apiKey !== null ||
        builtin.isActive !== true
      ) {
        tx.update(aiProviders).set({
          apiKey: null,
          isActive: true,
          updatedAt: new Date(),
        }).where(eq(aiProviders.id, builtinId)).run();
      }
    }
  }, { behavior: "immediate" });

  const configured = database.select({ provider: aiProviders.provider })
    .from(aiProviders).where(inArray(
      aiProviders.provider,
      ["codex_cli", "opencode_cli"]
    )).all();
  return configured.flatMap(({ provider }) =>
    isLocalCLIProvider(provider) ? [provider] : []
  );
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
    provider: "job_analysis_provider_id",
    model: "job_analysis_model",
    effort: "job_analysis_reasoning_effort",
  },
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
  deleteModelsCache?: (
    providerId: string,
    database: BetterSQLite3Database<typeof databaseSchema>
  ) => Promise<void>;
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

function decryptProviderApiKey(provider: ProviderRecord): string | undefined {
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

interface ProviderMutationDependencies {
  discoverCustomModels?: typeof discoverCustomProviderModels;
  deleteModelsCache?: (
    providerId: string,
    database: BetterSQLite3Database<typeof databaseSchema>
  ) => Promise<void>;
}

function buildNewCustomConnection(options: ProviderCreateBody): CustomProviderConnection {
  if (!options.displayName || !options.apiFormat || !options.baseUrl) {
    throw new AIError({
      type: "validation",
      message: "Custom provider name, API format, and URL are required",
      retryable: false,
    });
  }
  return {
    displayName: normalizeCustomDisplayName(options.displayName),
    apiFormat: options.apiFormat,
    baseUrl: normalizeCustomBaseUrl(options.baseUrl),
    apiKey: options.apiKey?.trim() || undefined,
    headers: normalizeCustomHeaders(options.headers ?? []),
    manualModelIds: normalizeManualModelIds(options.manualModelIds ?? []),
    reasoningEfforts: normalizeCustomReasoningEfforts(options.reasoningEfforts ?? []),
  };
}

export async function createProvider(
  options: ProviderCreateBody & { provider: AIProvider },
  database: BetterSQLite3Database<typeof databaseSchema> = db,
  dependencies: ProviderMutationDependencies = {}
): Promise<ProviderRecord> {
  if (options.provider !== "custom") {
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
  }

  const customConnection = options.provider === "custom"
    ? buildNewCustomConnection(options)
    : undefined;
  if (customConnection) {
    const discover = dependencies.discoverCustomModels ?? discoverCustomProviderModels;
    await discover(customConnection);
  }

  const allProviders = await database.select().from(aiProviders);
  const hasDefaultProvider = allProviders.some((provider) => provider.isDefault);
  const shouldBecomeDefault = !hasDefaultProvider && (
    isLocalCLIProvider(options.provider)
      ? allProviders.length === 0
      : allProviders.every((provider) => isLocalCLIProvider(provider.provider))
  );
  const encryptedApiKey = options.apiKey?.trim()
    ? encryptApiKey(options.apiKey.trim())
    : undefined;

  const created = await database
    .insert(aiProviders)
    .values({
      id: isLocalCLIProvider(options.provider)
        ? BUILTIN_CLI_PROVIDER_IDS[options.provider]
        : randomUUID(),
      provider: options.provider,
      apiKey: isLocalCLIProvider(options.provider) ? null : encryptedApiKey,
      displayName: customConnection?.displayName,
      apiFormat: customConnection?.apiFormat,
      baseUrl: customConnection?.baseUrl,
      encryptedHeaders: customConnection
        ? encryptCustomHeaders(customConnection.headers)
        : undefined,
      manualModelIds: customConnection
        ? JSON.stringify(customConnection.manualModelIds)
        : undefined,
      reasoningEfforts: customConnection
        ? JSON.stringify(customConnection.reasoningEfforts)
        : undefined,
      isActive: true,
      isDefault: shouldBecomeDefault,
      updatedAt: new Date(),
    })
    .returning();

  return created[0];
}

export async function updateProvider(
  providerId: string,
  patch: ProviderPatchBody,
  database: BetterSQLite3Database<typeof databaseSchema> = db,
  dependencies: ProviderMutationDependencies = {}
): Promise<void> {
  const provider = await requireProviderById(providerId, database);
  if (isLocalCLIProvider(provider.provider)) {
    throw new AIError({
      type: "validation",
      message: "Local CLI providers do not store API keys",
    });
  }
  const existingApiKey = decryptProviderApiKey(provider);
  const nextApiKey = patch.apiKey === undefined
    ? existingApiKey
    : patch.apiKey?.trim() || undefined;

  let customConnection: CustomProviderConnection | undefined;
  let customConnectivityChanged = false;
  let customCatalogChanged = false;
  if (provider.provider === "custom") {
    const current = resolveStoredCustomProvider(provider, existingApiKey);
    customConnection = {
      displayName: normalizeCustomDisplayName(patch.displayName ?? current.displayName),
      apiFormat: patch.apiFormat ?? current.apiFormat,
      baseUrl: normalizeCustomBaseUrl(patch.baseUrl ?? current.baseUrl),
      apiKey: nextApiKey,
      headers: patch.headers === undefined
        ? current.headers
        : mergeCustomHeaderPatch(current.headers, patch.headers),
      manualModelIds: patch.manualModelIds === undefined
        ? current.manualModelIds
        : normalizeManualModelIds(patch.manualModelIds),
      reasoningEfforts: patch.reasoningEfforts === undefined
        ? current.reasoningEfforts
        : normalizeCustomReasoningEfforts(patch.reasoningEfforts),
    };
    customConnectivityChanged = patch.apiKey !== undefined ||
      patch.apiFormat !== undefined ||
      patch.baseUrl !== undefined ||
      patch.headers !== undefined;
    customCatalogChanged = customConnectivityChanged ||
      patch.manualModelIds !== undefined ||
      patch.reasoningEfforts !== undefined;
    if (customConnectivityChanged) {
      const discover = dependencies.discoverCustomModels ?? discoverCustomProviderModels;
      await discover(customConnection);
    }
  } else if (
    patch.displayName !== undefined ||
    patch.apiFormat !== undefined ||
    patch.baseUrl !== undefined ||
    patch.headers !== undefined ||
    patch.manualModelIds !== undefined ||
    patch.reasoningEfforts !== undefined
  ) {
    throw new AIError({
      type: "validation",
      message: "Custom connection fields can only be updated on a custom provider",
      retryable: false,
    });
  }

  const encryptedApiKey = nextApiKey ? encryptApiKey(nextApiKey) : null;

  if (provider.provider !== "custom" || customCatalogChanged) {
    const deleteModelsCache = dependencies.deleteModelsCache ?? deleteStoredProviderModelsCache;
    await deleteModelsCache(providerId, database);
  }

  await database
    .update(aiProviders)
    .set({
      apiKey: encryptedApiKey,
      ...(customConnection
        ? {
            displayName: customConnection.displayName,
            apiFormat: customConnection.apiFormat,
            baseUrl: customConnection.baseUrl,
            encryptedHeaders: encryptCustomHeaders(customConnection.headers),
            manualModelIds: JSON.stringify(customConnection.manualModelIds),
            reasoningEfforts: JSON.stringify(customConnection.reasoningEfforts),
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(aiProviders.id, providerId));
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
  const apiCandidates = candidates.filter(({ provider: candidateProvider }) =>
    !isLocalCLIProvider(candidateProvider)
  );
  const localCLICandidates = candidates.filter(({ provider: candidateProvider }) =>
    isLocalCLIProvider(candidateProvider)
  );
  const fallbackCandidates = [...apiCandidates, ...localCLICandidates];

  let fallback: {
    providerId: string;
    modelId: string;
    reasoningEffort: string;
  } | null = null;
  if (impactedFeatures.length > 0) {
    for (const candidate of fallbackCandidates) {
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

  await deleteModelsCache(providerId, database);
  if (isLocalCLIProvider(provider.provider)) {
    await retireLocalCLIProvider(provider.provider);
  }
  database.transaction((tx) => {
    tx.delete(aiProviders).where(eq(aiProviders.id, providerId)).run();

    if (isLocalCLIProvider(provider.provider)) {
      tx.delete(settings).where(inArray(settings.key, [
        `local_cli_model_catalog:${provider.provider}`,
        CLI_EXECUTABLE_CONFIG[provider.provider].settingKey,
      ])).run();
    }

    if (provider.isDefault && fallbackCandidates.length > 0) {
      const defaultProviderId = fallback?.providerId ?? fallbackCandidates[0]!.id;
      tx.update(aiProviders)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(aiProviders.isActive, true))
        .run();
      tx.update(aiProviders)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(aiProviders.id, defaultProviderId))
        .run();
    }

    if (impactedFeatures.length === 0) return;

    const impactedSettingKeys = impactedFeatures.flatMap(({ provider: providerKey, model, effort }) => [
      providerKey,
      model,
      effort,
    ]);
    if (!fallback) {
      tx.delete(settings).where(inArray(settings.key, impactedSettingKeys)).run();
      return;
    }

    const now = new Date();
    const updates = impactedFeatures.flatMap(({ provider: providerKey, model, effort }) => [
      { key: providerKey, value: fallback.providerId, updatedAt: now },
      { key: model, value: fallback.modelId, updatedAt: now },
      { key: effort, value: fallback.reasoningEffort, updatedAt: now },
    ]);
    for (const update of updates) {
      tx.insert(settings).values(update).onConflictDoUpdate({
        target: settings.key,
        set: { value: update.value, updatedAt: now },
      }).run();
    }
  }, { behavior: "immediate" });

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
