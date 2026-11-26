import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { z } from "zod";

import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import type * as databaseSchema from "@/lib/db/schema";

import { providerConnectionSnapshotSchema, type ProviderConnectionSnapshot } from "./contracts";

const storedStatusSchema = z.object({
  revision: z.number(),
  snapshot: providerConnectionSnapshotSchema,
});
const settingKey = (id: string) => `provider_connection_status:${id}`;

// Snapshots describe the last observation. They never establish execution readiness.
export function createConnectionStatusRepository(database: BetterSQLite3Database<typeof databaseSchema>) {
  return {
    async load(id: string, revision = 0): Promise<ProviderConnectionSnapshot | undefined> {
      const row = await database.select({ value: settings.value }).from(settings)
        .where(eq(settings.key, settingKey(id))).limit(1);
      if (!row[0]?.value) return undefined;
      try {
        const stored = storedStatusSchema.parse(JSON.parse(row[0].value));
        return stored.revision === revision ? stored.snapshot : undefined;
      } catch {
        return undefined;
      }
    },
    async save(id: string, snapshot: ProviderConnectionSnapshot, revision = 0): Promise<void> {
      const value = JSON.stringify(storedStatusSchema.parse({ revision, snapshot }));
      await database.insert(settings).values({ key: settingKey(id), value, updatedAt: new Date() })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    },
    async delete(id: string): Promise<void> {
      await database.delete(settings).where(eq(settings.key, settingKey(id)));
    },
  };
}

export const connectionStatusRepository = createConnectionStatusRepository(db);
