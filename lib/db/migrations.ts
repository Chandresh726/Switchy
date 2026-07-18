import type Database from "better-sqlite3";
import { asc, desc, eq, ne } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type * as databaseSchema from "./schema";
import { aiProviders, aiRuns, settings } from "./schema";

interface ProviderMigrationRecord {
  id: string;
  provider: string;
  isActive: boolean | null;
  isDefault: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

function isMissingTableError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("no such table");
}

function reconcileDuplicateNonCustomProviders(
  database: BetterSQLite3Database<typeof databaseSchema>
): void {
  let providers: ProviderMigrationRecord[];
  try {
    providers = database.select({
      id: aiProviders.id,
      provider: aiProviders.provider,
      isActive: aiProviders.isActive,
      isDefault: aiProviders.isDefault,
      createdAt: aiProviders.createdAt,
      updatedAt: aiProviders.updatedAt,
    }).from(aiProviders)
      .where(ne(aiProviders.provider, "custom"))
      .orderBy(
        desc(aiProviders.isDefault),
        desc(aiProviders.isActive),
        desc(aiProviders.updatedAt),
        asc(aiProviders.createdAt),
        asc(aiProviders.id)
      ).all();
  } catch (error) {
    if (isMissingTableError(error)) return;
    throw error;
  }

  const groups = new Map<string, ProviderMigrationRecord[]>();
  for (const provider of providers) {
    const group = groups.get(provider.provider) ?? [];
    group.push(provider);
    groups.set(provider.provider, group);
  }
  if (Array.from(groups.values()).every((group) => group.length < 2)) return;

  database.transaction((tx) => {
    for (const duplicates of groups.values()) {
      const survivor = duplicates[0];
      if (!survivor || duplicates.length < 2) continue;
      for (const duplicate of duplicates.slice(1)) {
        tx.update(settings).set({ value: survivor.id })
          .where(eq(settings.value, duplicate.id)).run();
        tx.delete(settings)
          .where(eq(settings.key, `provider_model_catalog:${duplicate.id}`)).run();
        try {
          tx.update(aiRuns).set({ providerRecordId: survivor.id })
            .where(eq(aiRuns.providerRecordId, duplicate.id)).run();
        } catch (error) {
          if (!isMissingTableError(error)) throw error;
        }
        tx.delete(aiProviders).where(eq(aiProviders.id, duplicate.id)).run();
      }
    }
  });
}

export function migrateLocalDatabase(
  database: BetterSQLite3Database<typeof databaseSchema>,
  migrationsFolder: string
): void {
  const sqlite = (database as unknown as { $client: Database.Database }).$client;
  sqlite.pragma("foreign_keys = OFF");
  try {
    reconcileDuplicateNonCustomProviders(database);
    migrate(database, { migrationsFolder });
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
  const foreignKeyViolations = sqlite.pragma("foreign_key_check") as unknown[];
  if (foreignKeyViolations.length > 0) {
    throw new Error(`Migration left ${foreignKeyViolations.length} foreign-key violation(s)`);
  }
  const integrity = sqlite.pragma("integrity_check") as Array<{ integrity_check: string }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
    throw new Error("Migration failed SQLite integrity validation");
  }
}
