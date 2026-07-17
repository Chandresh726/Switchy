import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { migrateLocalDatabase } from "@/lib/db/migrations";
import * as schema from "@/lib/db/schema";
import { ensureStateDir, getDbPath } from "@/lib/state/paths";

ensureStateDir();
const sqlite = new Database(getDbPath());
try {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  migrateLocalDatabase(drizzle(sqlite, { schema }), path.join(process.cwd(), "drizzle"));
  console.log("Database migrations and integrity checks completed");
} finally {
  sqlite.close();
}
