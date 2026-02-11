import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { ensureStateDir, getDbPath } from "../state/paths";

// Ensure state directory exists before connecting to database
ensureStateDir();
const sqlite = new Database(getDbPath());

// Enable WAL mode for better performance
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

export { schema };
