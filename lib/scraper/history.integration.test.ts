import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";
import {
  companies,
  matchSessions,
  scrapeMatchOutbox,
  scrapeQueueItems,
  scrapeSessions,
  scrapingLogs,
} from "@/lib/db/schema";

import { deleteScrapeHistory, pruneScrapeHistory } from "./history";

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

describe("pruneScrapeHistory", () => {
  it("deletes only history older than the bounded local retention window", () => {
    const database = createTestDatabase();
    const now = new Date("2026-07-13T00:00:00.000Z");
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    database.insert(scrapeSessions).values([
      {
        id: "old-session",
        triggerSource: "manual",
        status: "completed",
        companiesTotal: 0,
        completedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
      {
        id: "legacy-terminal-session",
        triggerSource: "manual",
        status: "failed",
        companiesTotal: 0,
        startedAt: new Date("2020-01-01T00:00:00.000Z"),
        completedAt: null,
      },
      {
        id: "recent-session",
        triggerSource: "manual",
        status: "completed",
        companiesTotal: 0,
        completedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      {
        id: "active-session",
        triggerSource: "manual",
        status: "in_progress",
        companiesTotal: 0,
        completedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "stopping-session",
        triggerSource: "manual",
        status: "failed",
        companiesTotal: 1,
        completedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "matching-session",
        triggerSource: "manual",
        status: "completed",
        companiesTotal: 1,
        completedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]).run();
    database.insert(scrapeQueueItems).values({
      id: "stopping-item",
      sessionId: "stopping-session",
      companyId: company.id,
      status: "running",
      cancelRequested: true,
      workerId: "worker-1",
      leaseExpiresAt: new Date("2026-07-14T00:00:00.000Z"),
    }).run();
    const log = database
      .insert(scrapingLogs)
      .values({
        companyId: company.id,
        sessionId: "matching-session",
        status: "success",
      })
      .returning({ id: scrapingLogs.id })
      .get();
    database.insert(matchSessions).values({
      id: "pending-match",
      triggerSource: "auto_match",
      companyId: company.id,
      status: "queued",
      jobsTotal: 0,
    }).run();
    database.insert(scrapeMatchOutbox).values({
      id: "pending-match",
      scrapingLogId: log.id,
      companyId: company.id,
      jobIdsJson: "[]",
      status: "pending",
    }).run();

    const result = pruneScrapeHistory(90, database, now);

    expect(result).toEqual({
      deleted: 2,
      cutoff: new Date("2026-04-14T00:00:00.000Z"),
    });
    expect(database.select().from(scrapeSessions).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "recent-session" }),
        expect.objectContaining({ id: "active-session" }),
        expect.objectContaining({ id: "stopping-session" }),
        expect.objectContaining({ id: "matching-session" }),
      ])
    );
  });

  it("prunes large local histories in bounded SQLite parameter batches", () => {
    const database = createTestDatabase();
    database.insert(scrapeSessions).values(
      Array.from({ length: 250 }, (_, index) => ({
        id: `old-session-${index}`,
        triggerSource: "scheduler",
        status: "completed",
        companiesTotal: 0,
        completedAt: new Date("2020-01-01T00:00:00.000Z"),
      }))
    ).run();

    const result = pruneScrapeHistory(
      90,
      database,
      new Date("2026-07-13T00:00:00.000Z")
    );

    expect(result.deleted).toBe(250);
    expect(database.select().from(scrapeSessions).all()).toHaveLength(0);
  });
});
