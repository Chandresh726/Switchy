import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type * as databaseSchema from "./schema";

export function migrateLocalDatabase(
  database: BetterSQLite3Database<typeof databaseSchema>,
  migrationsFolder: string
): void {
  const sqlite = (database as unknown as { $client: Database.Database }).$client;
  sqlite.pragma("foreign_keys = OFF");
  try {
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
