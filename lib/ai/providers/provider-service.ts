import { randomUUID } from "crypto";

import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { AIError } from "@/lib/ai/shared/errors";
import { db } from "@/lib/db";
import { aiProviders } from "@/lib/db/schema";
import type * as databaseSchema from "@/lib/db/schema";
import { decryptApiKey, encryptApiKey } from "@/lib/encryption";

import { deleteStoredProviderModelsCache } from "./model-catalog";
import { BUILTIN_CLI_PROVIDER_IDS } from "../local-cli/constants";
import { getProviderMetadata } from "./metadata";
import { providerRegistry } from "./index";
import { isAIProvider, isLocalCLIProvider, type AIProvider } from "./types";

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

export async function ensureBuiltinCLIProviders(
  database: BetterSQLite3Database<typeof databaseSchema> = db
): Promise<void> {
  const now = new Date();
  await database
    .insert(aiProviders)
    .values([
      {
        id: BUILTIN_CLI_PROVIDER_IDS.codex_cli,
        provider: "codex_cli",
        isActive: true,
        isDefault: false,
        updatedAt: now,
      },
      {
        id: BUILTIN_CLI_PROVIDER_IDS.opencode_cli,
        provider: "opencode_cli",
        isActive: true,
        isDefault: false,
        updatedAt: now,
      },
    ])
    .onConflictDoNothing({ target: aiProviders.id });
}

export async function listProviders(): Promise<ProviderRecord[]> {
  await ensureBuiltinCLIProviders();
  return db.select().from(aiProviders).orderBy(aiProviders.createdAt);
}

export async function getProviderById(providerId: string): Promise<ProviderRecord | null> {
  const result = await db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.id, providerId))
    .limit(1);
  return result[0] ?? null;
}

export async function requireProviderById(providerId: string): Promise<ProviderRecord> {
  const provider = await getProviderById(providerId);
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
}): Promise<ProviderRecord> {
  if (isLocalCLIProvider(options.provider)) {
    throw new AIError({
      type: "validation",
      message: "Local CLI providers are created automatically",
    });
  }
  await ensureBuiltinCLIProviders();
  const allProviders = await db.select().from(aiProviders);
  const isFirstProvider = !allProviders.some(
    (provider) => !isLocalCLIProvider(provider.provider)
  );
  const encryptedApiKey = options.apiKey?.trim()
    ? encryptApiKey(options.apiKey.trim())
    : undefined;

  const created = await db
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

export async function deleteProvider(providerId: string): Promise<void> {
  const provider = await requireProviderById(providerId);
  if (isLocalCLIProvider(provider.provider)) {
    throw new AIError({
      type: "validation",
      message: "Built-in local CLI providers cannot be deleted",
    });
  }

  await db.delete(aiProviders).where(eq(aiProviders.id, providerId));
  await deleteStoredProviderModelsCache(providerId);

  if (!provider.isDefault) {
    return;
  }

  const remaining = await db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.isActive, true))
    .orderBy(asc(aiProviders.createdAt));
  const remainingAPIProviders = remaining.filter(
    (candidate) => !isLocalCLIProvider(candidate.provider)
  );

  if (remainingAPIProviders.length === 0) {
    return;
  }

  await db
    .update(aiProviders)
    .set({
      isDefault: false,
      updatedAt: new Date(),
    })
    .where(eq(aiProviders.isActive, true));

  await db
    .update(aiProviders)
    .set({
      isDefault: true,
      updatedAt: new Date(),
    })
    .where(eq(aiProviders.id, remainingAPIProviders[0].id));
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
