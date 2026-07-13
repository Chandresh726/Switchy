import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";
import { companies, scrapeQueueItems, scrapeSessions } from "@/lib/db/schema";

import { deleteScrapeHistory } from "./history";

vi.mock("@/lib/db", () => ({ db: {} }));

const openConnections: Database.Database[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const connection of openConnections.splice(0)) connection.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createTestDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "switchy-scrape-history-"));
  temporaryDirectories.push(directory);
  const connection = new Database(join(directory, "switchy.db"));
  openConnections.push(connection);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  const database = drizzle(connection, { schema });
  migrate(database, { migrationsFolder: join(process.cwd(), "drizzle") });
  return database;
}

describe("deleteScrapeHistory", () => {
  it("rejects deletion of a specific active scrape session", () => {
    const database = createTestDatabase();
    database.insert(scrapeSessions).values({
      id: "active-session",
      triggerSource: "manual",
      status: "in_progress",
      companiesTotal: 1,
    }).run();

    const result = deleteScrapeHistory("active-session", database);

    expect(result).toEqual({ active: true, deleted: 0 });
    expect(database.select().from(scrapeSessions).all()).toHaveLength(1);
  });

  it("clears terminal history without deleting active leased work", () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    database.insert(scrapeSessions).values([
      {
        id: "active-session",
        triggerSource: "manual",
        status: "in_progress",
        companiesTotal: 1,
      },
      {
        id: "completed-session",
        triggerSource: "manual",
        status: "completed",
        companiesTotal: 0,
        completedAt: new Date(),
      },
    ]).run();
    database.insert(scrapeQueueItems).values({
      id: "running-item",
      sessionId: "active-session",
      companyId: company.id,
      status: "running",
      workerId: "worker-1",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }).run();

    const result = deleteScrapeHistory(undefined, database);

    expect(result).toEqual({ active: false, deleted: 1 });
    expect(
      database
        .select()
        .from(scrapeSessions)
        .where(eq(scrapeSessions.id, "active-session"))
        .get()
    ).toBeDefined();
    expect(database.select().from(scrapeQueueItems).get()).toMatchObject({
      id: "running-item",
      status: "running",
    });
  });

  it("preserves a stopped session until its running item acknowledges cancellation", () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    database.insert(scrapeSessions).values({
      id: "stopping-session",
      triggerSource: "manual",
      status: "failed",
      companiesTotal: 1,
      completedAt: new Date(),
    }).run();
    database.insert(scrapeQueueItems).values({
      id: "cancelling-item",
      sessionId: "stopping-session",
      companyId: company.id,
      status: "running",
      workerId: "worker-1",
      cancelRequested: true,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }).run();

    expect(deleteScrapeHistory("stopping-session", database)).toEqual({
      active: true,
      deleted: 0,
    });
    expect(deleteScrapeHistory(undefined, database)).toEqual({
      active: false,
      deleted: 0,
    });
    expect(database.select().from(scrapeSessions).get()).toBeDefined();
    expect(database.select().from(scrapeQueueItems).get()).toMatchObject({
      status: "running",
      cancelRequested: true,
    });
  });
});
