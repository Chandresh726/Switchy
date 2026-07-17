import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach } from "vitest";

import { migrateLocalDatabase } from "@/lib/db/migrations";
import * as schema from "@/lib/db/schema";

interface SqliteConnectionOptions {
  busyTimeoutMs?: number;
}

interface SqliteDatabaseOptions extends SqliteConnectionOptions {
  fileName?: string;
  migrate?: boolean;
}

const createDrizzleDatabase = (connection: Database.Database) =>
  drizzle(connection, { schema });

export function createSqliteTestHarness(prefix: string) {
  const connections: Database.Database[] = [];
  const directories: string[] = [];

  const openConnection = (
    databasePath: string,
    options: SqliteConnectionOptions = {}
  ) => {
    const connection = new Database(databasePath);
    connections.push(connection);
    connection.pragma("journal_mode = WAL");
    connection.pragma("foreign_keys = ON");
    connection.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 1_000}`);
    return connection;
  };

  const connect = (
    databasePath: string,
    options: SqliteConnectionOptions = {}
  ) => {
    const connection = openConnection(databasePath, options);
    return { connection, database: createDrizzleDatabase(connection) };
  };

  const createDatabase = (options: SqliteDatabaseOptions = {}) => {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    directories.push(directory);
    const path = join(directory, options.fileName ?? "switchy.db");
    const opened = connect(path, options);
    if (options.migrate !== false) {
      migrateLocalDatabase(opened.database, join(process.cwd(), "drizzle"));
    }
    return { ...opened, path };
  };

  afterEach(() => {
    for (const connection of connections.splice(0)) connection.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  return { connect, createDatabase };
}
