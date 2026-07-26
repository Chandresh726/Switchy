import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { ensureStateDir, getDbPath } from "../state/paths";

// Ensure state directory exists before connecting to database
ensureStateDir();
const sqlite = new Database(getDbPath());

// Apply the lock wait before any pragma that may need a write lock.
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
